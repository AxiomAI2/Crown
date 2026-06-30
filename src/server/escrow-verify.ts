import { DEVNET_RPC, DEVNET_USDC_MINT, ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { type EscrowAccount, decodeEscrow, escrowPda } from "@/lib/chain/escrow-tx";
import { getMeta } from "@/server/store-db";
import { Connection, PublicKey } from "@solana/web3.js";

/** M3: префикс meta-ключа, под которым event-индексер пишет ончейн-исход эскроу по его PDA (base58). */
export const ESCROW_OUTCOME_META_PREFIX = "escrowOutcome:";

type EscrowOutcome = "to_streamer" | "to_donor";

/**
 * Прочитать эскроу-аккаунт по hex `task_id`. Возвращает `{ pda, escrow }` — `escrow=null`, если аккаунт
 * закрыт (заклеймлен) или не принадлежит программе. Возвращает `null`, если эскроу не настроен, `task_id`
 * битый или RPC недоступен. PDA нужен и при закрытом аккаунте (для M3-записи), поэтому отдаём его отдельно.
 */
async function readEscrowAccount(
  escrowTaskId: string,
): Promise<{ pda: PublicKey; escrow: EscrowAccount | null } | null> {
  if (!ESCROW_PROGRAM_ID || !/^[0-9a-fA-F]{64}$/.test(escrowTaskId)) return null;
  try {
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const pda = escrowPda(programId, Uint8Array.from(Buffer.from(escrowTaskId, "hex")));
    const info = await new Connection(DEVNET_RPC, "confirmed").getAccountInfo(pda);
    return { pda, escrow: info && info.owner.equals(programId) ? decodeEscrow(info.data) : null };
  } catch {
    return null; // сбой RPC / decode
  }
}

/**
 * Трастлесс-сверка ончейн-эскроу задания (G3a, ADR 0017). Сервер НЕ верит клиенту, что `fund` прошёл:
 * читает аккаунт из devnet и сверяет донора, сумму, mint, payout-стримера (ESC-6) и что он СВЕЖИЙ
 * (state == Pending). Любое несовпадение / сбой / закрытый аккаунт → false (fail-closed).
 */
export async function verifyEscrowOnChain(
  escrowTaskId: string,
  expect: { donor: string; amount: string; streamer?: string },
): Promise<boolean> {
  const r = await readEscrowAccount(escrowTaskId);
  if (!r?.escrow) return false;
  const e = r.escrow;
  return (
    e.donor.toBase58() === expect.donor &&
    e.amount === BigInt(expect.amount) &&
    (!DEVNET_USDC_MINT || e.mint.toBase58() === DEVNET_USDC_MINT) &&
    // ESC-6: эскроу обязан указывать на payout именно ЭТОГО канала; state==Pending — свежий, не пере-использован.
    (!expect.streamer || e.streamer.toBase58() === expect.streamer) &&
    e.state === 0 // 0 = Pending (TaskState)
  );
}

/**
 * ESC-12/M3 — ончейн-исход эскроу для реконсайла репутации (деньги = истина). Сеттлер банкует репутацию
 * только при ИЗВЕСТНОМ исходе. Живая `resolution` (ToStreamer|ToDonor) — пока аккаунт открыт; после закрытия
 * (claim) исход берём из M3-записи event-индексера. `null` — исход неизвестен (Unresolved / ещё не
 * проиндексирован / сбой RPC) → банковку откладываем (не угадываем по офчейн-таймеру).
 */
export async function readEscrowOutcome(escrowTaskId: string): Promise<EscrowOutcome | null> {
  const r = await readEscrowAccount(escrowTaskId);
  if (!r) return null; // не настроено / битый id / сбой RPC → откладываем
  if (!r.escrow) {
    // Аккаунт закрыт → зафиксированный event-индексером исход claim'а (истина денег переживает закрытие).
    const rec = await getMeta(ESCROW_OUTCOME_META_PREFIX + r.pda.toBase58());
    return rec === "to_streamer" || rec === "to_donor" ? rec : null;
  }
  return r.escrow.resolution === 1 ? "to_streamer" : r.escrow.resolution === 2 ? "to_donor" : null;
}
