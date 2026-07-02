/**
 * Devnet E2E (Фаза 3): доказывает ончейн-механику без браузера. Локальные keypair'ы стоят за донора/
 * стримера/трежери (в проде донора подписывает кошелёк). Поток: airdrop SOL → создать mint (devnet
 * USDC-стенд-ин) → начислить донору → собрать донат-tx (97/3 + memo + ATA) → отправить → индексер
 * разбирает из цепочки → движок репутации считает очки. Запуск: `npx tsx scripts/devnet-smoke.ts`.
 */
import {
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { DEVNET_RPC } from "../src/lib/chain/config";
import { buildDonationInstructions, splitAmount } from "../src/lib/chain/donation-tx";
import { parseDonationTx } from "../src/lib/chain/indexer";
import { pointsForAmount } from "../src/lib/reputation";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function airdrop(connection: Connection, pubkey: Keypair["publicKey"], sol: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      return;
    } catch (e) {
      console.log(`  airdrop retry ${i + 1}: ${String(e)}`);
      await sleep(2500);
    }
  }
  throw new Error("airdrop failed after retries (devnet rate limit?)");
}

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const donor = Keypair.generate();
  const streamer = Keypair.generate();
  const treasury = Keypair.generate();
  console.log("donor:   ", donor.publicKey.toBase58());
  console.log("streamer:", streamer.publicKey.toBase58());
  console.log("treasury:", treasury.publicKey.toBase58());

  console.log("→ airdrop 2 SOL to donor (devnet)…");
  await airdrop(connection, donor.publicKey, 2);

  console.log("→ create mint (devnet USDC stand-in, 6 decimals)…");
  const mint = await createMint(connection, donor, donor.publicKey, null, 6);
  console.log("  mint:", mint.toBase58());

  console.log("→ mint 1000 USDC to donor…");
  const donorAta = await getOrCreateAssociatedTokenAccount(connection, donor, mint, donor.publicKey);
  await mintTo(connection, donor, mint, donorAta.address, donor, 1_000_000_000n); // 1000 USDC

  const amountMicro = 10_000_000n; // 10 USDC
  console.log("→ build + send donation tx (10 USDC, 97/3 + memo)…");
  const ix = await buildDonationInstructions(connection, {
    donor: donor.publicKey,
    payout: streamer.publicKey,
    treasury: treasury.publicKey,
    mint,
    amountMicro,
    creatorId: "ch-lumi",
    donationId: "d-devnet-1",
    msgRef: "m-devnet-1",
  });
  const tx = new Transaction().add(...ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [donor], { commitment: "finalized" });
  console.log("  signature:", sig);

  console.log("→ indexer parses the donation from chain…");
  const streamerAta = await getAssociatedTokenAddress(mint, streamer.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
  let indexed = null;
  for (let i = 0; i < 8 && !indexed; i++) {
    indexed = await parseDonationTx(connection, sig, { mint, treasuryAta });
    if (!indexed) await sleep(2000);
  }
  if (!indexed) throw new Error("indexer did not recognize the donation");

  const split = splitAmount(amountMicro);
  const points = pointsForAmount(indexed.amountMicro);

  console.log("\n=== RESULT ===");
  console.log(
    JSON.stringify(
      {
        onchain_signature: sig,
        indexed_amount_micro: indexed.amountMicro.toString(),
        indexed_net_micro: indexed.netMicro.toString(),
        indexed_fee_micro: indexed.feeMicro.toString(),
        expected_net_micro: split.net.toString(),
        expected_fee_micro: split.fee.toString(),
        split_ok: indexed.netMicro === split.net && indexed.feeMicro === split.fee,
        donor_matches: indexed.donor === donor.publicKey.toBase58(),
        memo: indexed.memo,
        reputation_points: points,
      },
      null,
      2,
    ),
  );

  // assertions
  if (indexed.donor !== donor.publicKey.toBase58()) throw new Error("donor mismatch");
  if (indexed.amountMicro !== amountMicro) throw new Error("amount mismatch");
  if (indexed.netMicro !== split.net || indexed.feeMicro !== split.fee) throw new Error("split mismatch");
  if (indexed.streamerAta !== streamerAta.toBase58()) throw new Error("streamer ATA mismatch");
  if (indexed.memo.c !== "ch-lumi" || indexed.memo.d !== "d-devnet-1") throw new Error("memo mismatch");
  // Курс 1 USDC = 1 очко (ADR 0007): за 10 USDC — ровно 10 очков.
  if (points !== 10) throw new Error(`points mismatch: ${points}`);

  console.log("\n✅ DEVNET E2E OK — on-chain donation → indexer → reputation all match.");
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
