/**
 * Смоук эскроу-программы (G3a) против ЖИВОЙ программы на devnet. Проверяет билдеры `escrow-tx.ts` и сам
 * контракт на СВОЁМ тестовом mint (не Circle USDC — нужен mint authority):
 *   happy:  fund → mark_done → (ждём окно спора) → resolve_timeout → claim_streamer  (97/3, эскроу закрыт)
 *   refund: fund → reject → claim_donor  (100% назад)
 *   audit#1: чужой ключ НЕ может mark_disputed (резолвер захардкожен в программе → clawback закрыт)
 *
 * Резолвер/трежери теперь протокольные КОНСТАНТЫ контракта (аудит #1), поэтому смоук резолвит исход только
 * через permissionless resolve_timeout (ждёт окно), а не resolve_dispute (его подписывает лишь оператор).
 *
 * Запуск: export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"; npx tsx scripts/escrow-smoke.ts
 */
import {
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  buildClaimDonorIxs,
  buildClaimStreamerIxs,
  buildFundIx,
  buildMarkDisputedIx,
  buildMarkDoneIx,
  buildRejectIx,
  buildResolveTimeoutIx,
  escrowPda,
} from "../src/lib/chain/escrow-tx";

const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4",
);
// Трежери — протокольная константа контракта (escrow.treasury = TREASURY). Должна совпадать с lib.rs.
const TREASURY = new PublicKey("9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe");
const AMOUNT = 5_000_000n;
const FEE = (AMOUNT * 300n) / 10_000n; // 0.15
const NET = AMOUNT - FEE; // 4.85
const EXEC_WINDOW = 600n; // 10 мин — markDone успеваем; окно спора (2 мин) ждём отдельно
const DISPUTE_WAIT_MS = 135_000; // > DISPUTE_WINDOW (тест: 2 мин)

const loadPayer = () =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
function randTaskId(): Uint8Array {
  const a = new Uint8Array(32);
  for (let i = 0; i < 32; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}
async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  return sendAndConfirmTransaction(conn, tx, [payer, ...signers], { commitment: "confirmed" });
}
const bal = async (conn: Connection, ata: PublicKey) => {
  try {
    return (await getAccount(conn, ata)).amount;
  } catch {
    return 0n;
  }
};
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadPayer(); // = донор
  const donor = payer;
  const streamer = Keypair.generate();
  console.log("program:", PROGRAM_ID.toBase58());

  const mint = await createMint(conn, payer, payer.publicKey, null, 6);
  const donorAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, donor.publicKey))
    .address;
  await mintTo(conn, payer, mint, donorAta, payer, Number(AMOUNT) * 2);
  console.log("mint:", mint.toBase58());
  // Стример сам платит газ+ренту при claim (claim-модель) — выдаём ему немного SOL.
  await send(
    conn,
    [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: streamer.publicKey, lamports: 20_000_000 })],
    payer,
    [],
  );

  const fund = (taskId: Uint8Array) =>
    buildFundIx({
      programId: PROGRAM_ID,
      donor: donor.publicKey,
      streamer: streamer.publicKey,
      mint,
      taskId,
      amount: AMOUNT,
      executionWindow: EXEC_WINDOW,
    });

  // ───────── happy-path (через permissionless resolve_timeout) ─────────
  console.log("\n[happy] fund → mark_done → (ждём окно спора) → resolve_timeout → claim_streamer");
  const t1 = randTaskId();
  const escrow1 = escrowPda(PROGRAM_ID, t1);
  await send(conn, [await fund(t1)], payer, []);
  assert((await conn.getAccountInfo(escrow1)) !== null, "эскроу создан после fund");
  await send(conn, [buildMarkDoneIx(PROGRAM_ID, streamer.publicKey, t1)], payer, [streamer]);

  // audit #1: резолвер захардкожен → чужой ключ (стример) не может пометить спорным.
  let disputeBlocked = false;
  try {
    await send(conn, [buildMarkDisputedIx(PROGRAM_ID, streamer.publicKey, t1)], payer, [streamer]);
  } catch {
    disputeBlocked = true;
  }
  assert(disputeBlocked, "чужой ключ НЕ может mark_disputed (резолвер — константа, clawback закрыт)");

  console.log(`  ждём ${DISPUTE_WAIT_MS / 1000}с (окно спора)…`);
  await new Promise((r) => setTimeout(r, DISPUTE_WAIT_MS));
  await send(conn, [buildResolveTimeoutIx(PROGRAM_ID, payer.publicKey, t1)], payer, []);
  await send(
    conn,
    await buildClaimStreamerIxs(conn, {
      programId: PROGRAM_ID,
      streamer: streamer.publicKey,
      donor: donor.publicKey,
      treasury: TREASURY,
      mint,
      taskId: t1,
    }),
    payer,
    [streamer],
  );
  const streamerAta = await getAssociatedTokenAddress(mint, streamer.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(mint, TREASURY);
  assert((await bal(conn, streamerAta)) === NET, `стример получил 97% (${NET})`);
  assert((await bal(conn, treasuryAta)) === FEE, `трежери получило 3% (${FEE})`);
  assert((await conn.getAccountInfo(escrow1)) === null, "эскроу закрыт после claim");

  // ───────── refund-path ─────────
  console.log("\n[refund] fund → reject → claim_donor (100%)");
  const before = await bal(conn, donorAta);
  const t2 = randTaskId();
  await send(conn, [await fund(t2)], payer, []);
  assert((await bal(conn, donorAta)) === before - AMOUNT, "сумма списана в эскроу");
  await send(conn, [buildRejectIx(PROGRAM_ID, streamer.publicKey, t2)], payer, [streamer]);
  await send(
    conn,
    await buildClaimDonorIxs(conn, { programId: PROGRAM_ID, donor: donor.publicKey, mint, taskId: t2 }),
    payer,
    [],
  );
  assert((await bal(conn, donorAta)) === before, "донору вернулось 100%");

  console.log("\n✅ ВСЕ ПРОВЕРКИ ПРОШЛИ");
}

main().catch((e) => {
  console.error("\n❌", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
