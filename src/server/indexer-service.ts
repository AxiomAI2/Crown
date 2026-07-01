import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, type PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "@/lib/chain/config";
import { decodeEscrowClaims } from "@/lib/chain/escrow-tx";
import { fetchNewProgramSignatures, fetchNewTreasurySignatures } from "@/lib/chain/indexer";
import type { MockDataProvider } from "@/lib/data/mock-provider";
import { ESCROW_OUTCOME_META_PREFIX } from "@/server/escrow-verify";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { getMeta, setMeta } from "@/server/store-db";

/**
 * Фоновый индексер (Phase 4 / надёжность). Сам следит за цепочкой и доганяет ончейн-донаты НЕЗАВИСИМО от
 * браузера донатера: даже если клиент закрылся до ingest, донат (деньги + очки) не теряется. Все донаты и
 * сборы активации платят комиссию в treasury, поэтому достаточно следить за ОДНИМ адресом — treasury-ATA.
 *
 * RPC берётся из DEVNET_RPC (env NEXT_PUBLIC_DEVNET_RPC; по умолчанию бесплатный публичный) — переход на
 * провайдера (Helius/QuickNode) = смена этой переменной, код не трогаем. Курсор (последняя обработанная
 * подпись) хранится в meta → опрос не начинает с нуля после рестарта. Работает только в chain-режиме.
 *
 * Запускается из store.ts один раз на процесс. ВАЖНО: это долгоживущий цикл — ок для отдельного/локального
 * Node-сервера; в serverless-проде индексер выносят в отдельный воркер/крон (тот же ingestSignature).
 */
const POLL_MS = 20_000;
const CURSOR_KEY = "indexerCursor";
const ESCROW_CURSOR_KEY = "escrowIndexerCursor";

/**
 * M3 — event-индексер эскроу-программы. Сканирует подписи программы и фиксирует ончейн-исход `claim`'ов
 * (`claim_streamer` → to_streamer, `claim_donor` → to_donor) в meta по PDA эскроу. Это ИСТИНА ДЕНЕГ, которая
 * переживает закрытие аккаунта (claim закрывает эскроу в той же tx) — сеттлер читает её через readEscrowOutcome
 * и банкует репутацию строго за реально ушедшими деньгами (закрывает хвост ESC-12/16: «репутация ≠ деньги»).
 * Возвращает true, если что-то записал.
 */
async function scanEscrowClaims(connection: Connection, programId: PublicKey): Promise<boolean> {
  const cursor = (await getMeta(ESCROW_CURSOR_KEY)) ?? undefined;
  const sigs = await fetchNewProgramSignatures(connection, programId, cursor);
  let wrote = false;
  for (const sig of sigs) {
    const tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
    // B3: tx ещё не отдалась (транзиентный RPC / не доехала до confirmed) → НЕ двигаем курсор, повторим на
    // следующем опросе. Иначе claim-исход был бы пропущен навсегда → репутация по эскроу не начислится.
    if (!tx) break;
    const ixs = tx.transaction.message.instructions
      .filter((ix): ix is PartiallyDecodedInstruction => "data" in ix && "accounts" in ix)
      .map((ix) => ({ programId: ix.programId, accounts: ix.accounts, data: ix.data }));
    for (const { escrow, outcome } of decodeEscrowClaims(programId, ixs)) {
      await setMeta(ESCROW_OUTCOME_META_PREFIX + escrow, outcome);
      wrote = true;
    }
    await setMeta(ESCROW_CURSOR_KEY, sig); // обработано → двигаем курсор (claim/прочая tx программы)
    await new Promise((r) => setTimeout(r, 200)); // бережём бесплатный RPC
  }
  return wrote;
}

/**
 * M3 on-demand: досканировать claim-исходы ПРЯМО СЕЙЧАС (вне фонового опроса). Нужен на горячем пути claim:
 * chain-провайдер только что сделал resolve_timeout+claim ончейн (эскроу закрыт), а фоновый индексер ещё не
 * записал исход → off-chain settle иначе откладывает и claim падает с NOT_RESOLVED, хотя деньги уже вернулись.
 * Курсор общий с фоновым циклом (идемпотентно). Тихо возвращает false, если эскроу-программа не настроена.
 */
export async function scanEscrowClaimsNow(): Promise<boolean> {
  if (!ESCROW_PROGRAM_ID) return false;
  const connection = new Connection(DEVNET_RPC, "confirmed");
  return scanEscrowClaims(connection, new PublicKey(ESCROW_PROGRAM_ID));
}

export function startIndexer(store: MockDataProvider, persist: () => void): void {
  if (process.env.NEXT_PUBLIC_DATA_SOURCE !== "chain") return; // ончейн-донатов нет вне chain
  const g = globalThis as unknown as { __indexerOn?: boolean };
  if (g.__indexerOn) return; // один цикл на процесс (переживает HMR)
  g.__indexerOn = true;
  void runLoop(store, persist);
}

async function runLoop(store: MockDataProvider, persist: () => void): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const treasuryAta = await getAssociatedTokenAddress(mintPubkey(), treasuryPubkey());
  console.log(`[indexer] слежу за treasury-ATA ${treasuryAta.toBase58()} (RPC ${DEVNET_RPC})`);

  for (;;) {
    try {
      const cursor = (await getMeta(CURSOR_KEY)) ?? undefined;
      const sigs = await fetchNewTreasurySignatures(connection, treasuryAta, cursor);
      let changed = false;
      for (const sig of sigs) {
        // Донат?
        const d = await ingestSignature(store, sig);
        if (d.pending) break; // ещё не финализирован — повторим со следующего опроса, курсор не двигаем
        if (d.ok) changed = true;
        else {
          // Не донат — возможно, сбор активации.
          const a = await ingestActivation(store, sig);
          if (a.pending) break;
          if (a.ok) changed = true;
        }
        await setMeta(CURSOR_KEY, sig); // обработано (донат/активация/чужая tx) → двигаем курсор
        await new Promise((r) => setTimeout(r, 250)); // бережём бесплатный RPC (лимиты запросов)
      }
      if (changed) persist();
    } catch (e) {
      console.error("[indexer] ошибка опроса:", e instanceof Error ? e.message : e);
    }

    // M3: фиксируем ончейн-исходы claim'ов ДО сеттлера — чтобы он читал истину денег даже по закрытым эскроу.
    try {
      if (ESCROW_PROGRAM_ID) {
        const wrote = await scanEscrowClaims(connection, new PublicKey(ESCROW_PROGRAM_ID));
        if (wrote) persist();
      }
    } catch (e) {
      console.error("[escrow-indexer] ошибка:", e instanceof Error ? e.message : e);
    }

    // Фоновый сеттлер заданий-игры (G3a, ADR 0017 / 0015 §2): банкует репутацию при резолве ПО ВРЕМЕНИ
    // независимо от браузера (репутация оффчейн-детерминирована из журнала; деньги не трогаем — claim-
    // модель). Идемпотентно: settle() не трогает уже RESOLVED. Канал без игры → GAME_NOT_ENABLED, пропуск.
    try {
      const channels = await store.listChannels();
      let settledAny = false;
      for (const c of channels.items) {
        try {
          const r = (await store.gameAction({
            gameId: "escrow-task",
            channelId: c.channelId,
            op: "settleDue",
          })) as { settled: number };
          if (r.settled > 0) settledAny = true;
        } catch {
          /* игра не включена на канале / прочее — пропускаем */
        }
      }
      if (settledAny) persist();
    } catch (e) {
      console.error("[settler] ошибка:", e instanceof Error ? e.message : e);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
