import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { USDC_DECIMALS, splitAmount } from "./config";
import { buildMemoInstruction, encodeActivationMemo, encodeMemo } from "./memo";

export { splitAmount }; // ре-экспорт (исторические импортеры берут его отсюда); определение — в addresses.ts

export interface DonationTxParams {
  donor: PublicKey;
  payout: PublicKey; // владелец payout-аккаунта стримера
  treasury: PublicKey; // владелец трежери
  mint: PublicKey; // USDC mint (devnet)
  amountMicro: bigint;
  creatorId: string;
  donationId: string;
  msgRef?: string | null;
}

/**
 * Инструкции донат-транзакции (docs/yellow-paper.md §3.1): одна tx, деньги идут НАПРЯМУЮ донор→стример (97%) и
 * донор→трежери (3%), оператор средства доната не трогает (некастодиальность, инвариант §4.1).
 * ATA стримера/трежери создаются при отсутствии (платит донор). Memo несёт атрибуцию.
 */
export async function buildDonationInstructions(
  connection: Connection,
  p: DonationTxParams,
): Promise<TransactionInstruction[]> {
  const { fee, net } = splitAmount(p.amountMicro);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const streamerAta = await getAssociatedTokenAddress(p.mint, p.payout);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);

  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, streamerAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.donor, streamerAta, p.payout, p.mint));
  }
  if (!(await accountExists(connection, treasuryAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.donor, treasuryAta, p.treasury, p.mint));
  }
  // 97% стримеру, 3% трежери — две transferChecked-инструкции.
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, streamerAta, p.donor, net, USDC_DECIMALS));
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, treasuryAta, p.donor, fee, USDC_DECIMALS));
  ix.push(buildMemoInstruction(encodeMemo({ c: p.creatorId, d: p.donationId, m: p.msgRef ?? null })));
  return ix;
}

export interface ActivationTxParams {
  payer: PublicKey; // владелец канала
  treasury: PublicKey;
  mint: PublicKey;
  channelId: string;
  feeMicro: bigint;
}

/**
 * Инструкции сбора активации (yellow-paper §3.1): один перевод payer→трежери (~$2) + memo `{act}`.
 * Сбор, не залог — оператор не возвращает (некастодиальность). ATA трежери создаётся при отсутствии.
 */
export async function buildActivationInstructions(
  connection: Connection,
  p: ActivationTxParams,
): Promise<TransactionInstruction[]> {
  const payerAta = await getAssociatedTokenAddress(p.mint, p.payer);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, treasuryAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.payer, treasuryAta, p.treasury, p.mint));
  }
  ix.push(
    createTransferCheckedInstruction(payerAta, p.mint, treasuryAta, p.payer, p.feeMicro, USDC_DECIMALS),
  );
  ix.push(buildMemoInstruction(encodeActivationMemo(p.channelId)));
  return ix;
}

async function accountExists(connection: Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}
