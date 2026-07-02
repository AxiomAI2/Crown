import { MockDataProvider, type StoreSnapshot } from "@/lib/data/mock-provider";
import { readEscrowOutcome, readEscrowState, verifyEscrowOnChain } from "@/server/escrow-verify";
import { scanEscrowClaimsNow, startIndexer } from "@/server/indexer-service";
import { readSnapshot } from "@/server/persist";
import { currentIdentity } from "@/server/request-context";
import { loadStore, saveStore } from "@/server/store-db";

/**
 * Серверное хранилище. Источник истины — журнал событий; репутация считается тем же ОБЩИМ движком
 * (lib/reputation.ts), что и в моке → цифры совпадают (инвариант §4.4, ADR 0001).
 *
 * Персистентность (Phase 4): состояние живёт в реальных таблицах Postgres (PGlite, src/server/db.ts +
 * store-db.ts). При старте грузим из БД; если БД ещё пуста — одноразово переносим прежний JSON-снимок
 * (.data/store.json). После мутаций пишем обратно в таблицы. Логика стора работает на in-memory копии;
 * прямые SQL-чтения без копии — оптимизация на потом.
 *
 * Singleton (как Promise) и его сейвер кэшируются на globalThis: переживают HMR в dev, шарятся между запросами.
 */
const STORE_FILE = "store.json";
const g = globalThis as unknown as {
  __standingStorePromise?: Promise<MockDataProvider>;
  __standingSave?: () => void;
};

export function getStore(): Promise<MockDataProvider> {
  if (!g.__standingStorePromise) g.__standingStorePromise = init();
  return g.__standingStorePromise;
}

async function init(): Promise<MockDataProvider> {
  const store = new MockDataProvider();
  // H3: личность запроса — из per-request AsyncLocalStorage (request-context), а не из мутируемого поля.
  store.__setIdentityResolver(() => currentIdentity() ?? null);
  // Серверные хуки сверки эскроу (ADR 0017/ESC-12): инжектим ТОЛЬКО здесь (store.ts — серверный модуль), чтобы
  // `@/server/escrow-verify` → store-db → PGlite/node:path не утягивались в клиентский бандл mock-провайдера.
  store.verifyEscrowHook = (id, expect) => verifyEscrowOnChain(id, expect);
  // Исход эскроу с самолечением гонки: claim только что прошёл ончейн (эскроу закрыт), но фоновый индексер
  // ещё не записал исход → readEscrowOutcome вернул бы null и off-chain claim упал бы с NOT_RESOLVED, хотя
  // деньги уже вернулись донору (инцидент «Забрать → задание не разрешено»). При промахе досканируем claim-tx
  // сейчас (курсор общий, идемпотентно) и перечитываем. Сбой скана (429/RPC) не рушит claim — вернём прежний null.
  store.escrowOutcomeHook = async (id) => {
    const outcome = await readEscrowOutcome(id);
    if (outcome !== null) return outcome;
    try {
      await scanEscrowClaimsNow();
    } catch {
      return null;
    }
    return readEscrowOutcome(id);
  };
  // ESC-19: сырое ончейн-состояние — индексер по нему раскрывает текст задания при ончейн-`accept`.
  store.escrowStateHook = (id) => readEscrowState(id);

  const snap = await loadStore();
  if (snap) {
    store.__restore(snap);
  } else {
    // Одноразовая миграция: Postgres пуст → переносим существующий JSON-снимок в БД.
    const file = readSnapshot<StoreSnapshot>(STORE_FILE);
    if (file) store.__restore(file);
    await saveStore(store.__snapshot());
  }

  g.__standingSave = makeSaver(store);
  startIndexer(store, persistStore); // фоновый приём ончейн-донатов (только chain-режим)
  return store;
}

/** Запланировать сохранение стора в Postgres. Зовётся route-хендлером после мутаций. */
export function persistStore(): void {
  g.__standingSave?.();
}

/**
 * Сохранение после мутаций: коалесцирует всплески и НЕ пускает два сохранения параллельно (saveStore
 * перезаписывает таблицы целиком — параллельный прогон мог бы пересечься). Ошибку логируем, не роняем запрос.
 */
function makeSaver(store: MockDataProvider): () => void {
  let saving = false;
  let pending = false;
  const run = async () => {
    saving = true;
    while (pending) {
      pending = false;
      try {
        await saveStore(store.__snapshot());
      } catch (e) {
        console.error("[pg-persist] не удалось сохранить стор:", e);
      }
    }
    saving = false;
  };
  return () => {
    pending = true;
    if (!saving) void run();
  };
}
