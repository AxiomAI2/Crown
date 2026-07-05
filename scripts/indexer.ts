/**
 * Индексер-сервис (Фаза 3, yellow-paper §5): «истина о деньгах — цепочка». Опрашивает treasury ATA на
 * devnet, и для каждой новой подписи зовёт бэкенд `ingestSignature` (сервер сам достаёт tx и валидирует).
 * Идемпотентно (повтор не дублирует). Запуск рядом с `npm run dev`: `npx tsx scripts/indexer.ts`.
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "../src/lib/chain/config";
import { fetchNewTreasurySignatures } from "../src/lib/chain/indexer";
import { decode, encode } from "../src/lib/data/codec";

const API = process.env.STANDING_API ?? "http://localhost:3000/api/v1/rpc";
const POLL_MS = 8000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ingest(signature: string): Promise<unknown> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encode({ method: "ingestSignature", args: [signature] }),
  });
  return decode<{ ok: boolean; result?: unknown; error?: unknown }>(await res.text());
}

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const treasuryAta = await getAssociatedTokenAddress(mintPubkey(), treasuryPubkey());
  console.log("indexer → treasury ATA:", treasuryAta.toBase58());
  console.log("indexer → backend:", API);

  // sigs, по которым зачёт завершён (ok) либо они невалидны/не наши/уже приняты — их больше не трогаем.
  // Остальные (pending: видны на confirmed, но ещё не finalized) ПОВТОРЯЕМ на следующем поле. Нельзя слепо
  // проматывать прошлое по `last`: донат, увиденный на confirmed до финализации, потерялся бы навсегда
  // (был ровно такой класс багов — M2/M3). Идемпотентность ingest делает повторы безопасными.
  const done = new Set<string>();

  for (;;) {
    try {
      const sigs = await fetchNewTreasurySignatures(connection, treasuryAta); // последние ~50
      for (const sig of sigs) {
        if (done.has(sig)) continue;
        const r = await ingest(sig);
        const inner = ((r as { result?: unknown })?.result ?? {}) as {
          ok?: boolean;
          pending?: boolean;
        };
        if (inner.ok) {
          done.add(sig);
          console.log("ingest", sig.slice(0, 16), "→ ok", JSON.stringify(inner));
        } else if (inner.pending) {
          console.log("ingest", sig.slice(0, 16), "→ pending (повтор позже)");
        } else {
          done.add(sig); // невалидная / уже принято / нет канала — не повторяем
          console.log("ingest", sig.slice(0, 16), "→ skip", JSON.stringify(inner));
        }
      }
    } catch (e) {
      console.log("poll error:", String(e));
    }
    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error("indexer fatal:", e);
  process.exit(1);
});
