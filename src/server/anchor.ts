import { readFileSync } from "fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { DEVNET_RPC } from "@/lib/chain/config";
import { buildMemoInstruction } from "@/lib/chain/memo";
import { sha256Hex, stableStringify } from "@/lib/data/canonical";
import type { MockDataProvider } from "@/lib/data/mock-provider";
import { getMeta, setMeta } from "@/server/store-db";

/**
 * Пруф-якорь: периодическая memo-транзакция с дайджестами оффчейн-состояния (журнал репутации, версии
 * конфигов, операторский лог: инцидент-лог + действия оператора). Цель — прозрачность
 * централизованного слоя: операторский T&S и конфиги остаются
 * управляемыми (это фича, yellow-paper §10), но каждое состояние получает несмываемый ончейн-отпечаток
 * с меткой времени. Тихо переписать прошлое (журнал, версию конфига, «этого тейкдауна не было») нельзя —
 * третья сторона пересчитывает дайджесты из /api/v1/export/anchor и сверяет с memo в цепочке
 * (scripts/verify-export.ts).
 *
 * Деньги якорь НЕ трогает: подписант платит только свой газ (никакого ключа над чужими средствами, §4.1).
 * Ключ задаётся env `ANCHOR_SIGNER_KEYPAIR` (путь к keypair.json или inline JSON-массив); без ключа
 * якорь выключен (фича аддитивная — её отсутствие не ломает приём денег).
 */

export const ANCHOR_MEMO_TAG = "standing-anchor/1";
const META_KEY = "anchorLast";
// Не чаще раза в интервал (дефолт 1 час): якорим СОСТОЯНИЕ, а не каждое событие — газ копеечный, но
// спамить цепочку незачем. Изменений нет → нового якоря нет вовсе.
const MIN_INTERVAL_MS = Number(process.env.ANCHOR_INTERVAL_MS ?? 60 * 60_000);

export interface AnchorDigests {
  ledger: string; // sha256(stableStringify(все события журнала))
  configs: string; // sha256(stableStringify(все версии конфигов всех каналов))
  // Операторский лог (инцидент-лог + действия оператора /ops) — НЕ решения канальных модераторов
  // стримера (те живут в состоянии сообщений). Контент приватен → sha256({incidents: [...], actions: [...]}).
  operatorLog: string;
}

export interface AnchorBundle {
  digests: AnchorDigests;
  ledgerCount: number;
  incidentHashes: string[];
  actionHashes: string[];
}

/** Последний опубликованный якорь (meta) — для экспорта и защиты от повторной публикации. */
export interface AnchorRecord extends AnchorDigests {
  signature: string;
  ts: string;
  ledgerCount: number;
}

/**
 * Дайджесты текущего состояния. Операторский лог содержит приватный текст (§4.6) — в дайджест и наружу идут
 * ТОЛЬКО пер-записные хэши: целостность и полнота проверяемы, содержимое не раскрывается.
 */
export async function computeAnchorBundle(store: MockDataProvider): Promise<AnchorBundle> {
  const { ledger, configs, incidents, operatorActions } = store.exportAnchorData();
  const incidentHashes = await Promise.all(incidents.map((i) => sha256Hex(stableStringify(i))));
  const actionHashes = await Promise.all(operatorActions.map((a) => sha256Hex(stableStringify(a))));
  return {
    digests: {
      ledger: await sha256Hex(stableStringify(ledger)),
      configs: await sha256Hex(stableStringify(configs)),
      operatorLog: await sha256Hex(
        stableStringify({ incidents: incidentHashes, actions: actionHashes }),
      ),
    },
    ledgerCount: ledger.length,
    incidentHashes,
    actionHashes,
  };
}

export async function anchorStatus(): Promise<AnchorRecord | null> {
  const raw = await getMeta(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnchorRecord;
  } catch {
    return null;
  }
}

function loadAnchorKeypair(): Keypair | null {
  const v = process.env.ANCHOR_SIGNER_KEYPAIR;
  if (!v) return null;
  try {
    const raw = v.trim().startsWith("[") ? v : readFileSync(v, "utf8");
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw) as number[]));
  } catch (e) {
    console.error("[anchor] ANCHOR_SIGNER_KEYPAIR не читается:", e instanceof Error ? e.message : e);
    return null;
  }
}

let warnedNoKey = false;

/**
 * Опубликовать якорь, если состояние изменилось и интервал прошёл. Идемпотентно к вызовам из цикла
 * индексера; сбой RPC не критичен — следующая попытка на следующем тике. Возвращает true при публикации.
 */
export async function maybeAnchor(store: MockDataProvider): Promise<boolean> {
  const { digests, ledgerCount } = await computeAnchorBundle(store);
  const last = await anchorStatus();
  if (
    last &&
    last.ledger === digests.ledger &&
    last.configs === digests.configs &&
    last.operatorLog === digests.operatorLog
  )
    return false; // состояние не менялось — якорить нечего
  if (last && Date.now() - Date.parse(last.ts) < MIN_INTERVAL_MS) return false; // подождём интервал

  const kp = loadAnchorKeypair();
  if (!kp) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.log("[anchor] ANCHOR_SIGNER_KEYPAIR не задан — пруф-якорь выключен");
    }
    return false;
  }

  const ts = new Date().toISOString();
  const memo = JSON.stringify({
    std: ANCHOR_MEMO_TAG,
    t: ts,
    n: ledgerCount,
    j: digests.ledger,
    c: digests.configs,
    o: digests.operatorLog,
  });
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const tx = new Transaction().add(buildMemoInstruction(memo));
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await connection.sendTransaction(tx, [kp]);

  const record: AnchorRecord = { ...digests, signature, ts, ledgerCount };
  await setMeta(META_KEY, JSON.stringify(record));
  console.log(`[anchor] якорь опубликован: ${signature}`);
  return true;
}
