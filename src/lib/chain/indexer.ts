import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import { splitAmount } from "./donation-tx";
import { decodeActivationMemo, decodeMemo, type MemoAttribution } from "./memo";

/** Истина о деньгах — цепочка, не клиент (yellow-paper §5.1). Реконструированный донат из ончейна. */
export interface IndexedDonation {
  signature: string;
  donor: string;
  amountMicro: bigint;
  feeMicro: bigint;
  netMicro: bigint;
  streamerAta: string; // ATA-получатель 97%-ноги — сверяется с payout канала вызывающим
  memo: MemoAttribution;
  blockTime: number | null;
}

interface SplTransferParsed {
  type: string;
  info: {
    authority: string;
    destination: string;
    mint: string;
    source: string;
    tokenAmount: { amount: string; decimals: number };
  };
}

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return (ix as ParsedInstruction).parsed !== undefined;
}

export async function parseDonationTx(
  connection: Connection,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey; commitment?: "confirmed" | "finalized" },
): Promise<IndexedDonation | null> {
  // M2: в chain-режиме зачёт ждёт "finalized" (защита от реорга на mainnet); "confirmed" — для отзывчивости devnet.
  const tx = await connection.getParsedTransaction(signature, {
    commitment: opts.commitment ?? "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  return extractDonation(tx, signature, opts);
}

/**
 * Чистый разбор: находит ногу-комиссию (transferChecked в treasuryAta) и парную ногу-нетто (другой
 * transferChecked того же mint от того же donor → ATA стримера) + memo. Самоконтроль комиссии: без
 * корректного расщепления 97/3 возвращает null (сырой перевод ≠ донат). Выделено для детерминированных тестов.
 */
export function extractDonation(
  tx: ParsedTransactionWithMeta | null,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey },
): IndexedDonation | null {
  if (!tx || tx.meta?.err) return null;
  const mint = opts.mint.toBase58();
  const treasury = opts.treasuryAta.toBase58();

  const transfers: { dest: string; amount: bigint; authority: string }[] = [];
  let memo: MemoAttribution | null = null;

  for (const ix of tx.transaction.message.instructions) {
    if (!isParsed(ix)) continue;
    if (ix.program === "spl-memo" && typeof ix.parsed === "string") {
      memo = decodeMemo(ix.parsed);
      continue;
    }
    if (ix.program === "spl-token") {
      const parsed = ix.parsed as SplTransferParsed;
      if (parsed.type !== "transferChecked" || parsed.info?.mint !== mint) continue;
      transfers.push({
        dest: parsed.info.destination,
        amount: BigInt(parsed.info.tokenAmount.amount),
        authority: parsed.info.authority,
      });
    }
  }

  // Добросовестный разбор (R2/ADR 0012): донат-tx нашего сборщика несёт РОВНО две ноги этого mint (нетто +
  // комиссия). Иное число → не наша tx (лишние ноги могли бы сместить netLeg на чужой ATA) — отбраковываем.
  if (transfers.length !== 2 || !memo) return null;
  const feeLeg = transfers.find((t) => t.dest === treasury);
  const netLeg = transfers.find((t) => t.dest !== treasury);
  if (!feeLeg || !netLeg) return null;
  if (feeLeg.authority !== netLeg.authority) return null;

  const amount = feeLeg.amount + netLeg.amount;
  const expected = splitAmount(amount);
  if (expected.fee !== feeLeg.amount || expected.net !== netLeg.amount) return null;

  return {
    signature,
    donor: netLeg.authority,
    amountMicro: amount,
    feeMicro: feeLeg.amount,
    netMicro: netLeg.amount,
    streamerAta: netLeg.dest,
    memo,
    blockTime: tx.blockTime ?? null,
  };
}

/** Реконструированный сбор активации из ончейна: один перевод payer→treasuryATA + memo `{act}`. */
export interface IndexedActivation {
  signature: string;
  payer: string; // authority перевода — сверяется с владельцем канала вызывающим
  amountMicro: bigint;
  channelId: string;
  blockTime: number | null;
}

/**
 * Чистый разбор сбора активации: ищет transferChecked нужного mint в treasuryAta + memo `{act}`.
 * Сумму НЕ валидирует здесь (порог проверяет ingest против ACTIVATION_FEE_MICRO). Выделено для тестов.
 */
export function extractActivation(
  tx: ParsedTransactionWithMeta | null,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey },
): IndexedActivation | null {
  if (!tx || tx.meta?.err) return null;
  const mint = opts.mint.toBase58();
  const treasury = opts.treasuryAta.toBase58();

  const transfers: { dest: string; amount: bigint; authority: string }[] = [];
  let act: string | null = null;

  for (const ix of tx.transaction.message.instructions) {
    if (!isParsed(ix)) continue;
    if (ix.program === "spl-memo" && typeof ix.parsed === "string") {
      act = decodeActivationMemo(ix.parsed)?.act ?? act;
      continue;
    }
    if (ix.program === "spl-token") {
      const parsed = ix.parsed as SplTransferParsed;
      if (parsed.type !== "transferChecked" || parsed.info?.mint !== mint) continue;
      transfers.push({
        dest: parsed.info.destination,
        amount: BigInt(parsed.info.tokenAmount.amount),
        authority: parsed.info.authority,
      });
    }
  }

  // Активация-tx нашего сборщика несёт РОВНО одну ногу этого mint — в трежери. Иное → не наша tx.
  if (transfers.length !== 1 || !act) return null;
  const leg = transfers[0];
  if (!leg || leg.dest !== treasury) return null;
  return {
    signature,
    payer: leg.authority,
    amountMicro: leg.amount,
    channelId: act,
    blockTime: tx.blockTime ?? null,
  };
}

/** Новые подписи входящих в treasury ATA после `afterSignature` (для индексер-сервиса). */
export async function fetchNewTreasurySignatures(
  connection: Connection,
  treasuryAta: PublicKey,
  afterSignature?: string,
): Promise<string[]> {
  const sigs = await connection.getSignaturesForAddress(treasuryAta, {
    until: afterSignature,
    limit: 50,
  });
  return sigs
    .filter((s) => !s.err)
    .map((s) => s.signature)
    .reverse();
}

/** M3: новые УСПЕШНЫЕ подписи эскроу-программы после `afterSignature` (для event-индексера claim'ов). */
export async function fetchNewProgramSignatures(
  connection: Connection,
  programId: PublicKey,
  afterSignature?: string,
): Promise<string[]> {
  const sigs = await connection.getSignaturesForAddress(programId, {
    until: afterSignature,
    limit: 50,
  });
  return sigs
    .filter((s) => !s.err)
    .map((s) => s.signature)
    .reverse();
}
