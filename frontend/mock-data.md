# DataProvider — контракт данных и мок-фикстуры

Это **краеугольный файл** проекта. Он описывает единственный интерфейс, через который фронтенд
получает и меняет данные. Пока (Фаза 1) за ним стоит `MockDataProvider` с данными в памяти; в Фазе 2
тот же интерфейс реализует `ApiDataProvider` (бэкенд), в Фазе 3 — `ChainDataProvider` (кошелёк + индексер).

**Правило, которое держит всю архитектуру:** ни один экран, компонент или хук не знает, какая реализация
работает под ним. Меняется только реализация, экраны не трогаются. Если компонент зовёт `fetch`/RPC/Solana
напрямую — это нарушение контракта (`CLAUDE.md` §3).

Типы сущностей — из `docs/data-model.md`. Здесь — методы, обёртки, поведение мока и фикстуры.

---

## 1. Интерфейс `DataProvider`

```ts
// Общие обёртки
type Result<T> = T;                       // бросает Error при сбое; TanStack ловит
interface Page<T> { items: T[]; cursor?: string }
interface ListOpts { cursor?: string; limit?: number }

interface Session {
  address: Address | null;                // null = не подключён
  level: ProfileLevel;
  isCreator: boolean;                      // владеет хотя бы одним каналом
  isOperator: boolean;                     // доступ к /ops (в моке — флаг фикстуры)
}

interface DonationInput {
  channelId: string;
  amountUSDC: number;                      // ввод пользователя в USDC (UI), не micro
  text?: string;                           // опц.; на BASIC-канале → отклоняется
}

interface DonationResult {
  donation: Donation;
  standing: ViewerStanding;                // пересчитанная репутация донора СРАЗУ
  tierChanged: boolean;                    // для FinalityMoment / tier-up анимации
}

interface DataProvider {
  // — Сессия / идентичность —
  getSession(): Result<Session>;
  connect(): Result<Session>;                       // Фаза 3: wallet-adapter + SIWS
  disconnect(): Result<void>;
  getProfile(address: Address): Result<LightProfile | null>;
  updateProfile(p: Partial<LightProfile>): Result<LightProfile>;

  // — Дискавери / каналы —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>>;   // только ACTIVE, публичные
  getChannel(handle: string): Result<Channel | null>;
  getChannelConfig(channelId: string): Result<ChannelConfig>;
  createChannel(input: { handle: string; payoutAddress: Address }): Result<Channel>;
  activateChannel(channelId: string): Result<Channel>;        // сбор ~$2 → BASIC→ACTIVE
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig>;

  // — Репутация / статус —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null>;
  // null = адрес ни разу не донатил на канал (нет событий в журнале). Подключённому-но-не-донатившему
  // UI сам рисует нулевого «Новичка» из tiers[0] конфига; /me просто пропускает каналы с null.
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]>;

  // — Донаты —
  createDonation(input: DonationInput): Result<DonationResult>;
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>>;   // публичные SHOWN

  // — Модерация (стример/модераторы) —
  getModerationQueue(channelId: string): Result<MessageRef[]>;     // HELD + FLAG сверху
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef>;

  // — Канальный блок-лист (стример) —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]>;
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock>;
  removeChannelBlock(channelId: string, address: Address): Result<void>;

  // — Оператор / T&S (платформенный уровень) —
  getOperatorQueue(): Result<IncidentLog[]>;
  applyOperatorAction(a: Omit<OperatorAction, "id" | "ts" | "byOperator">): Result<OperatorAction>;
  getIncidentLog(opts?: ListOpts): Result<Page<IncidentLog>>;

  // — Оверлей (read-only поток для OBS) —
  subscribeOverlay(channelId: string, cb: (e: OverlayEvent) => void): () => void; // возвращает unsubscribe
}
```

Вспомогательные типы, специфичные для UI:

```ts
interface ChannelCard {           // компактная карточка для дискавери
  channelId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  topTierName: string;            // напр. "Легенда"
  donorsCount: number;
  isLive?: boolean;               // косметика; в ядре опц.
}

type ConfigPatch = Partial<Pick<ChannelConfig,
  "reputation" | "tiers" | "minDonation" | "minDonationWithText" |
  "messageMaxLen" | "profanityPolicy" | "nameMode" | "textShowMode" |
  "overlay" | "moderators"
>>;
// ВАЖНО: смена reputation.curve/rate => bump configVersion, прошлое НЕ пересчитывается (банкинг).

type OverlayEvent =
  | { kind: "donation_shown"; donation: Donation; standing: ViewerStanding }
  | { kind: "tier_up"; donor: Address; tier: Tier };
```

---

## 2. Связка с хуками (TanStack Query)

Компоненты зовут **только** хуки, не провайдер напрямую. Хуки — тонкая обёртка над методами.

```ts
const provider = createDataProvider(process.env.NEXT_PUBLIC_DATA_SOURCE);

// queries
useSession()                          // → getSession
useChannel(handle)                    // → getChannel
useChannelConfig(channelId)
useStanding(channelId, address)
useLeaderboard(channelId, period)
useDonations(channelId)
useModerationQueue(channelId)
useChannelBlocklist(channelId)
useOperatorQueue()
useDiscovery()                        // → listChannels (infinite query)

// mutations (useMutation, с инвалидацией ключей)
useDonate(channelId)                  // → createDonation; инвалидирует standing+donations+leaderboard
useSetMessageState(channelId)         // → setMessageState; оптимистичный апдейт очереди
useUpdateConfig(channelId)            // → updateChannelConfig
useActivateChannel(channelId)         // → activateChannel
useAddBlock / useRemoveBlock(channelId)
useApplyOperatorAction()
useUpdateProfile()
```

Ключи кэша — стабильные кортежи: `["channel", handle]`, `["standing", channelId, address]`,
`["leaderboard", channelId, period]`, и т.д. После доната инвалидируются
`standing/donations/leaderboard` этого канала.

---

## 3. Поведение `MockDataProvider` (Фаза 1)

Мок — не заглушка, а **полноценный детерминированный симулятор**. Требования:

1. **In-memory store**, инициализируется из фикстур (§4). Один сид (`SEED = "standing-v0.1"`) → одинаковые
   данные при каждом запуске (стабильные скриншоты/ревью).
2. **Латентность.** Каждый метод ждёт `120–500ms` (детерминировано от имени метода + аргументов), чтобы
   loading-стейты были видны и реалистичны.
3. **Инъекция ошибок.** Флаг `MOCK_FAIL` (env или dev-тоггл в `/dev/kitchen-sink`): задаёт вероятность/таргет
   сбоя конкретного метода, чтобы прогонять error-стейты экранов. По умолчанию выкл.
4. **Симуляция переходов (главное — соблюсти инварианты `CLAUDE.md` §4):**
   - `createChannel({ handle, payoutAddress })`:
     - **один канал на кошелёк** (ADR `decisions/0002`): если у адреса сессии уже есть канал →
       бросить `ErrChannelAlreadyExists`; иначе создать `Channel { status: "BASIC" }`;
     - валидация `handle` (уникальность + формат) и `payoutAddress` (base58); `payoutAddress` по
       умолчанию = логин-адрес, но может отличаться.
   - `createDonation`:
     - валидация **в micro**: `toMicro(amountUSDC) ≥ minDonation` (или `minDonationWithText`, если есть текст);
       (никаких сравнений `number`-USDC напрямую — см. `spec.md` §4);
     - если `text` задан, но канал `BASIC` → бросить `ErrTextRequiresActiveChannel` (инвариант: BASIC без текста);
     - если донор в блок-листе канала и есть текст → отклонить текст-донат;
     - расщепить: `fee = 3%`, `net = 97%` (считать в micro-USDC, целочисленно);
     - **деньги финальны сразу**; создать `Donation { final: true }`;
     - начислить репутацию **немедленно** через движок (§3.1) — независимо от текста (инвариант «деньги ≠ показ»);
     - если есть текст → создать `MessageRef { state: "HELD" }` + прогнать мок-модерацию (§3.2);
     - вернуть `DonationResult` с пересчитанным `standing` и `tierChanged`.
   - `setMessageState("SHOWN")` → перевести HELD→SHOWN, выставить `shownAt`, эмитнуть `OverlayEvent`.
     **Не трогать деньги и репутацию** (инвариант). `"HIDDEN"` → HELD→HIDDEN, тоже без денег/репутации.
   - `updateChannelConfig` со сменой `reputation` → `configVersion++`, новый `hash`; **прошлые события
     не пересчитываются** (банкинг). Смена только тиров/косметики → версия не растёт.
   - `activateChannel` → `BASIC→ACTIVE`, `activatedAt = now`. (Списание ~$2 в моке — просто флаг.)
   - `applyOperatorAction("ADMIN_VOID")` → добавить отрицательное `LedgerEvent`, репутация падает
     (единственный путь падения в ядре). `SUSPEND/BAN` → менять `Channel.status`.
5. **Движок репутации — та же чистая функция, что в `backend/spec.md`.** Мок и бэкенд считают идентично;
   это и есть «детерминированность» (инвариант §4.4). Держать в `lib/reputation.ts`, импортить в обоих провайдерах.

### 3.1 Движок (контур; полная спека — `backend/spec.md`)

```ts
// чистая функция: журнал донора по каналу + конфиг → очки
function computePoints(events: LedgerEvent[], config: ReputationConfig): Points;
// curve(amount) по version-banked конфигу каждого события, × multipliers, × decay (если вкл).
// ADMIN_VOID вычитается. Сумма по всем событиям донора на канале.
```

### 3.2 Мок-модерация (упрощённый конвейер `docs/core-spec.md` §8; карантин/баны — §9)

```ts
// порядок: локальный wordlist → (мок) "auto" вердикт → state
function mockModerate(text: string): { verdict: ModerationVerdict; lang: string };
//  - содержит слово из MOCK_HARD_LIST   → HARD_BLOCK → state QUARANTINED (в очередь оператора)
//  - содержит слово из MOCK_FLAG_LIST   → FLAG       → остаётся HELD, помечен сверху очереди
//  - иначе                              → CLEAR      → HELD (ждёт ручного "Показать")
// textShowMode == "auto_if_clean" и verdict==CLEAR → авто-SHOWN (с буфером-задержкой)
```

---

## 4. Фикстуры (сид `standing-v0.1`)

Минимальный, но полный набор, покрывающий все экраны и состояния. Конкретные значения — стартовые;
важна форма и покрытие кейсов.

**Каналы (3 шт.) для покрытия статусов:**
- `lumi` — `ACTIVE`, богатый канал: 5 тиров (дефолтные пороги), `curve: bracket`, ~40 донатов, очередь
  модерации с примерами CLEAR/FLAG, непустой лидерборд, есть VIP и «Легенда». Витрина для скриншотов.
- `nova` — `ACTIVE`, свежий: `curve: linear (100)`, мало донатов, пустой лидерборд (empty-state).
- `kebab` — `BASIC` (не активирован): используется в флоу «BASIC отклоняет текст» и на экране активации.

**Идентичности / сессии (переключаемые в `/dev/kitchen-sink`):**
- `donorA` — `address_only`, донатил в `lumi` (тир «Постоянный»), для экрана `/me` и standing.
- `donorB` — `light` профиль (displayName, avatar), топ-донатер месяца в `lumi` (VIP/Легенда).
- `creatorL` — владелец `lumi`, `isCreator: true` → доступ к `/studio`.
- `operator` — `isOperator: true` → доступ к `/ops`.
- `guest` — `address: null` (не подключён) → состояния «подключите кошелёк».

**Журнал репутации `lumi`:** ~40 `DONATION` событий от ~12 адресов, разные суммы (от $1 до $500),
часть с текстом в разных состояниях (SHOWN/HELD/HIDDEN), 1 пример `ADMIN_VOID` (показать падение).

**Очередь модерации `lumi`:** 5–8 `MessageRef`:
- 2 × CLEAR (обычный текст, ждут «Показать»);
- 1 × FLAG (помечен, наверху);
- 1 × длинный (граница `messageMaxLen`);
- 1 × на другом языке (`lang: "es"` / `"ru"`) — мультиязычность;
- 1 × HIDDEN (уже скрыт, для истории).

**Лидерборд `lumi`:** заполнен для `all_time` и `month`; `top_donor_month` = `donorB`.
**Лидерборд `nova`:** пуст (empty-state).

**Блок-лист `lumi`:** 1 адрес (для экрана blocklist).
**Инцидент-лог оператора:** 1 `report`, 1 `hard_block` (QUARANTINED из `kebab`-теста), 1 `sanction_hit`.

**Дев-тогглы (`/dev/kitchen-sink`):** переключение сессии (любой из identities выше), `MOCK_FAIL` on/off,
сброс стора к сиду, «ускорить/замедлить латентность».

---

## 5. Что это даёт следующим фазам

- **Фаза 2 (`ApiDataProvider`):** реализует тот же интерфейс §1 через REST/tRPC к бэкенду. Экраны не меняются.
  Бэкенд использует **тот же** `computePoints`, что и мок → цифры совпадают. См. `backend/spec.md`.
- **Фаза 3 (`ChainDataProvider`):** `connect()`/`createDonation()` уходят в кошелёк (wallet-adapter, SIWS,
  сборка SPL-транзакции 97/3 + memo), чтение — через индексер. Тот же интерфейс. См. `crypto/spec.md`.

> Контракт §1 — это «шов» между фазами. Любое изменение интерфейса затрагивает все три реализации,
> поэтому правки сюда вносятся обдуманно и отражаются в `ROADMAP.md`.
