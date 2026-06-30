import { DEVNET_RPC, DEVNET_USDC_MINT, ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { decodeEscrow, escrowPda } from "@/lib/chain/escrow-tx";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Трастлесс-сверка ончейн-эскроу задания (G3a, ADR 0017). Сервер НЕ верит клиенту, что `fund` реально
 * прошёл: читает аккаунт эскроу из devnet по `escrowTaskId` и проверяет, что он принадлежит нашей программе
 * и совпадает по донору, сумме, mint, payout-стримеру (ESC-6) и что он СВЕЖИЙ (state == Pending). Возвращает
 * false при любом несовпадении/сбое (fail-closed) — задание без подтверждённого эскроу не записывается.
 * Только сервер (тянет web3.js; в стор инжектится динамически).
 */
export async function verifyEscrowOnChain(
  escrowTaskId: string,
  expect: { donor: string; amount: string; streamer?: string },
): Promise<boolean> {
  if (!ESCROW_PROGRAM_ID) return false; // не настроено — не пропускаем (fail-closed)
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(escrowTaskId)) return false; // ровно 32 байта hex
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const taskId = Uint8Array.from(Buffer.from(escrowTaskId, "hex"));
    const pda = escrowPda(programId, taskId);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const info = await conn.getAccountInfo(pda);
    if (!info || !info.owner.equals(programId)) return false;
    const e = decodeEscrow(info.data);
    if (e.donor.toBase58() !== expect.donor) return false;
    if (e.amount !== BigInt(expect.amount)) return false;
    if (DEVNET_USDC_MINT && e.mint.toBase58() !== DEVNET_USDC_MINT) return false;
    // ESC-6: эскроу обязан указывать на payout именно ЭТОГО канала, иначе задание канала C ссылалось бы на
    // чужой эскроу (расширяет поверхность реконсайла ESC-12). state==Pending — эскроу свежий, не пере-использован.
    if (expect.streamer && e.streamer.toBase58() !== expect.streamer) return false;
    if (e.state !== 0) return false; // 0 = Pending (TaskState)
    return true;
  } catch {
    return false; // битый id / сбой RPC / decode → не пропускаем
  }
}

/**
 * ESC-12 — реконсайл репутации против цепочки. Читает ончейн-исход эскроу (деньги = истина): сеттлер банкует
 * донат-репутацию только когда исход на цепочке ЗАФИКСИРОВАН (resolution = ToStreamer|ToDonor), а не по
 * офчейн-таймеру. `present=false` → эскроу закрыт (уже заклеймлен) или отсутствует. `outcome=null` → исход
 * ещё не зафиксирован (Unresolved) → банковку откладываем. Возвращает null при сбое RPC (fail-safe: не банкуем).
 */
export async function readEscrowOutcome(
  escrowTaskId: string,
): Promise<{ present: boolean; outcome: "to_streamer" | "to_donor" | null } | null> {
  if (!ESCROW_PROGRAM_ID) return null;
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(escrowTaskId)) return null;
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const taskId = Uint8Array.from(Buffer.from(escrowTaskId, "hex"));
    const pda = escrowPda(programId, taskId);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const info = await conn.getAccountInfo(pda);
    if (!info || !info.owner.equals(programId)) return { present: false, outcome: null };
    const e = decodeEscrow(info.data);
    // resolution: 1 = ToStreamer, 2 = ToDonor, 0 = Unresolved (исход ещё не зафиксирован на цепочке).
    const outcome = e.resolution === 1 ? "to_streamer" : e.resolution === 2 ? "to_donor" : null;
    return { present: true, outcome };
  } catch {
    return null; // сбой RPC → не банкуем в этот проход (повторим на следующем опросе сеттлера)
  }
}
