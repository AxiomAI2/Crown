import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/**
 * Билдеры инструкций к эскроу-программе задания-доната (G3a, ADR 0017; программа — `anchor/`). Вручную, без
 * anchor-IDL/клиента (стек на web3.js v1, как `donation-tx.ts`): Anchor-инструкция = 8-байтовый дискриминатор
 * `sha256("global:<имя>")[..8]` + Borsh-аргументы; аккаунты — в порядке `#[derive(Accounts)]` с флагами
 * signer/writable из программы. Деньги двигает только программа по детерминированному праву; получатели и
 * сумма зашиты в PDA при `fund` — украсть/перенаправить не может никто (некастодиальность §4.1).
 */

// Дискриминаторы (sha256("global:<fn>")[..8]) — посчитаны из имён функций программы.
const DISC = {
  fund: [218, 188, 111, 221, 152, 113, 174, 7],
  accept: [65, 150, 70, 216, 133, 6, 107, 4],
  reject: [135, 7, 63, 85, 131, 114, 111, 224],
  markDone: [112, 146, 215, 90, 40, 16, 44, 149], // mark_done
  cancel: [232, 219, 223, 41, 219, 236, 220, 190],
  resolveTimeout: [149, 55, 89, 144, 121, 143, 48, 210], // resolve_timeout
  markDisputed: [136, 86, 152, 120, 3, 21, 223, 251], // mark_disputed
  resolveDispute: [231, 6, 202, 6, 96, 103, 12, 230], // resolve_dispute
  claimStreamer: [126, 138, 229, 228, 43, 41, 147, 179], // claim_streamer
  claimDonor: [50, 4, 6, 190, 27, 110, 39, 211], // claim_donor
} as const;

const ESCROW_SEED = Buffer.from("escrow");

/** 32-байтовый идентификатор задания на цепочке = seed эскроу-PDA. Клиент генерит случайный при создании. */
export type TaskId = Uint8Array; // ровно 32 байта

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function disc(d: readonly number[]): Buffer {
  return Buffer.from(d);
}

/** PDA эскроу для задания: seeds = ["escrow", task_id]. */
export function escrowPda(programId: PublicKey, taskId: TaskId): PublicKey {
  return PublicKey.findProgramAddressSync([ESCROW_SEED, Buffer.from(taskId)], programId)[0];
}
/** Хранилище USDC эскроу — ATA, владелец = эскроу-PDA (off-curve). */
export function vaultAta(mint: PublicKey, escrow: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, escrow, true);
}

async function accountExists(connection: Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}

export interface FundParams {
  programId: PublicKey;
  donor: PublicKey;
  streamer: PublicKey; // payout-владелец стримера (контрагент донора). Трежери/резолвер — константы программы.
  mint: PublicKey;
  taskId: TaskId;
  amount: bigint; // micro-USDC
  executionWindow: bigint; // секунды (коридор [60 .. 90д] — проверяет программа)
}

/** `fund`: завести эскроу-PDA + хранилище и перевести amount USDC донор→хранилище (донор подписывает). */
export async function buildFundIx(p: FundParams): Promise<TransactionInstruction> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const data = Buffer.concat([
    disc(DISC.fund),
    Buffer.from(p.taskId),
    u64le(p.amount),
    i64le(p.executionWindow),
  ]);
  return new TransactionInstruction({
    programId: p.programId,
    data,
    keys: [
      { pubkey: p.donor, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: donorAta, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: p.streamer, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Действие стримера (accept/reject/mark_done): подписывает владелец payout-адреса. */
function streamerAction(
  programId: PublicKey,
  streamer: PublicKey,
  escrow: PublicKey,
  d: readonly number[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: disc(d),
    keys: [
      { pubkey: streamer, isSigner: true, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
    ],
  });
}
// accept больше не ончейн (бесплатный оффчейн-шаг) — билдера нет; DISC.accept оставлен для справки.
export function buildRejectIx(programId: PublicKey, streamer: PublicKey, taskId: TaskId) {
  return streamerAction(programId, streamer, escrowPda(programId, taskId), DISC.reject);
}
export function buildMarkDoneIx(programId: PublicKey, streamer: PublicKey, taskId: TaskId) {
  return streamerAction(programId, streamer, escrowPda(programId, taskId), DISC.markDone);
}

/** `cancel`: донор отменяет до принятия → возврат. */
export function buildCancelIx(programId: PublicKey, donor: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.cancel),
    keys: [
      { pubkey: donor, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

/** `resolve_timeout`: permissionless — решает блокчейн по часам (любой подписант платит за tx). */
export function buildResolveTimeoutIx(programId: PublicKey, caller: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.resolveTimeout),
    keys: [
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

/** `mark_disputed` (bounded резолвер): пометить эскроу спорным → resolve_timeout блокируется до резолва. */
export function buildMarkDisputedIx(programId: PublicKey, resolver: PublicKey, taskId: TaskId) {
  return new TransactionInstruction({
    programId,
    data: disc(DISC.markDisputed),
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

/** `resolve_dispute` (bounded, devnet): только зафиксированный резолвер; выбор стороны (toStreamer). */
export function buildResolveDisputeIx(
  programId: PublicKey,
  resolver: PublicKey,
  taskId: TaskId,
  toStreamer: boolean,
) {
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([disc(DISC.resolveDispute), Buffer.from([toStreamer ? 1 : 0])]),
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: escrowPda(programId, taskId), isSigner: false, isWritable: true },
    ],
  });
}

export interface ClaimStreamerParams {
  programId: PublicKey;
  streamer: PublicKey;
  donor: PublicKey; // получатель ренты при закрытии
  treasury: PublicKey;
  mint: PublicKey;
  taskId: TaskId;
}

/**
 * `claim_streamer`: стример забирает выигрыш (97% ему, 3% трежери), эскроу закрывается. Префиксуем
 * созданием ATA стримера/трежери, если их ещё нет (иначе перевод упадёт) — платит стример.
 */
export async function buildClaimStreamerIxs(
  connection: Connection,
  p: ClaimStreamerParams,
): Promise<TransactionInstruction[]> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const streamerAta = await getAssociatedTokenAddress(p.mint, p.streamer);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, streamerAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.streamer, streamerAta, p.streamer, p.mint));
  if (!(await accountExists(connection, treasuryAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.streamer, treasuryAta, p.treasury, p.mint));
  ix.push(
    new TransactionInstruction({
      programId: p.programId,
      data: disc(DISC.claimStreamer),
      keys: [
        { pubkey: p.streamer, isSigner: true, isWritable: false },
        { pubkey: p.donor, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: streamerAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  );
  return ix;
}

export interface ClaimDonorParams {
  programId: PublicKey;
  donor: PublicKey;
  mint: PublicKey;
  taskId: TaskId;
}

/** `claim_donor`: донор забирает возврат (100%), эскроу закрывается. donorAta уже есть (донор вносил USDC). */
export async function buildClaimDonorIxs(
  connection: Connection,
  p: ClaimDonorParams,
): Promise<TransactionInstruction[]> {
  const escrow = escrowPda(p.programId, p.taskId);
  const vault = await vaultAta(p.mint, escrow);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, donorAta)))
    ix.push(createAssociatedTokenAccountInstruction(p.donor, donorAta, p.donor, p.mint));
  ix.push(
    new TransactionInstruction({
      programId: p.programId,
      data: disc(DISC.claimDonor),
      keys: [
        { pubkey: p.donor, isSigner: true, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: donorAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  );
  return ix;
}

/** Декодер аккаунта Escrow (для индексера/чтения состояния): раскладка из программы (Anchor). */
export interface EscrowAccount {
  taskId: Uint8Array;
  donor: PublicKey;
  streamer: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  resolver: PublicKey;
  amount: bigint;
  executionWindow: bigint;
  state: number; // 0 Pending,1 Accepted,2 Done,3 Resolved
  resolution: number; // 0 Unresolved,1 ToStreamer,2 ToDonor
  acceptDeadline: bigint;
  doneDeadline: bigint;
  disputeDeadline: bigint;
  bump: number;
}

/** Разобрать сырые данные аккаунта Escrow (8 байт дискриминатора + поля в порядке struct). */
export function decodeEscrow(data: Uint8Array): EscrowAccount {
  const b = Buffer.from(data);
  let o = 8; // skip Anchor discriminator
  const take = (n: number) => {
    const s = b.subarray(o, o + n);
    o += n;
    return s;
  };
  const taskId = new Uint8Array(take(32));
  const donor = new PublicKey(take(32));
  const streamer = new PublicKey(take(32));
  const treasury = new PublicKey(take(32));
  const mint = new PublicKey(take(32));
  const resolver = new PublicKey(take(32));
  const amount = b.readBigUInt64LE(o);
  o += 8;
  const executionWindow = b.readBigInt64LE(o);
  o += 8;
  const state = b.readUInt8(o);
  o += 1;
  const resolution = b.readUInt8(o);
  o += 1;
  const acceptDeadline = b.readBigInt64LE(o);
  o += 8;
  const doneDeadline = b.readBigInt64LE(o);
  o += 8;
  const disputeDeadline = b.readBigInt64LE(o);
  o += 8;
  const bump = b.readUInt8(o);
  return {
    taskId,
    donor,
    streamer,
    treasury,
    mint,
    resolver,
    amount,
    executionWindow,
    state,
    resolution,
    acceptDeadline,
    doneDeadline,
    disputeDeadline,
    bump,
  };
}
