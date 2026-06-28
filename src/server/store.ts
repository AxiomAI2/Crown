import { MockDataProvider, type StoreSnapshot } from "@/lib/data/mock-provider";
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
