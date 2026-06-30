/**
 * Индексатор эскроу-программы (G3a, read-only): читает ВСЕ эскроу-аккаунты программы из devnet и печатает
 * их состояние + баланс хранилища (vault). Источник истины о деньгах — цепочка (crypto/spec §4); это
 * операторская видимость и фундамент для сверки оффчейн-зеркала / доганивания репутации (DONATION/REFUND).
 *
 *   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"   # не обязателен
 *   npx tsx scripts/escrow-indexer.ts
 */
import { getAccount } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeEscrow, vaultAta } from "../src/lib/chain/escrow-tx";

const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4",
);
const MINT = new PublicKey(
  process.env.NEXT_PUBLIC_DEVNET_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
// Размер аккаунта Escrow = 8 (Anchor-дискриминатор) + INIT_SPACE(235) — фильтруем по нему.
const ESCROW_SIZE = 243;
const STATE = ["Pending", "Accepted", "Done", "Resolved", "Disputed"];
const RES = ["Unresolved", "ToStreamer", "ToDonor"];
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const usdc = (micro: bigint) => `${(Number(micro) / 1e6).toFixed(2)} USDC`;

(async () => {
  const conn = new Connection(RPC, "confirmed");
  console.log("программа:", PROGRAM.toBase58(), "\n");
  const accts = await conn.getProgramAccounts(PROGRAM, { filters: [{ dataSize: ESCROW_SIZE }] });
  if (accts.length === 0) {
    console.log("эскроу-аккаунтов нет.");
    return;
  }
  console.log(`найдено эскроу: ${accts.length}\n`);
  let locked = 0n;
  for (const { pubkey, account } of accts) {
    const e = decodeEscrow(account.data);
    let vaultBal = 0n;
    try {
      vaultBal = (await getAccount(conn, await vaultAta(MINT, pubkey))).amount;
    } catch {
      /* хранилище закрыто (после claim) */
    }
    locked += vaultBal;
    console.log(`escrow ${pubkey.toBase58()}`);
    console.log(
      `  donor ${short(e.donor.toBase58())} → streamer ${short(e.streamer.toBase58())} | ` +
        `${usdc(e.amount)} | ${STATE[e.state]}/${RES[e.resolution]} | в хранилище: ${usdc(vaultBal)}`,
    );
  }
  console.log(`\nвсего заперто в эскроу: ${usdc(locked)}`);
})().catch((e) => {
  console.error("ERR", e?.message ?? e);
  process.exit(1);
});
