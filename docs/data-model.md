# Модель данных

> ⚠️ **Статус (2026-07-02):** частично устарела. Актуальная схема — `docs/yellow-paper.md` §13 и
> `src/server/db.ts`. Здесь неактуально: версионирование конфига описано как работающий механизм — в
> коде поля version/hash есть, но версии НЕ растут (updateChannelConfig правит последнюю на месте;
> yellow-paper §18.4); таблица identities удалена как мёртвая.

Канонические сущности ядра. Используется и фронтом (как форма мок-данных), и бэкендом (как схема БД).
Типы в TypeScript-нотации; на бэкенде → таблицы Postgres. Деньги — в **micro-USDC** (`bigint`, 6 знаков),
очки репутации — целые.

---

## 1. Базовые типы

```ts
type Address = string;        // Solana base58, напр. "7xKp...3fQa"
type MicroUSDC = bigint;      // 1 USDC = 1_000_000n
type Points = number;         // целые очки репутации
type Iso = string;            // ISO-8601 timestamp
type TxSignature = string;    // подпись транзакции Solana (Фаза 3)
```

---

## 2. Идентичность и профиль

```ts
type ProfileLevel = "address_only" | "light" | "creator";

interface Identity {
  address: Address;           // основа идентичности; кошелёк = аккаунт
  level: ProfileLevel;        // дефолт address_only
  sns?: string;               // опц. .sol-имя
}

interface LightProfile {      // только если level >= "light" (opt-in)
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  links?: string[];
}
```

> Мультикошельки **не агрегируются**. Платёжный адрес стримера может отличаться от логин-адреса.

---

## 3. Канал

```ts
type ChannelStatus = "BASIC" | "ACTIVE" | "SUSPENDED" | "BANNED";

interface Channel {
  id: string;                 // creator_id
  ownerAddress: Address;      // логин-адрес владельца
  payoutAddress: Address;     // куда идут донаты (может != ownerAddress)
  handle: string;             // публичный slug канала
  status: ChannelStatus;      // BASIC до уплаты сбора активации
  activatedAt?: Iso;
  configVersion: number;      // текущая версия конфига репутации
  createdAt: Iso;
}
```

Переходы статуса: `BASIC → ACTIVE` (сбор активации) → `SUSPENDED` (авто, до ревью) → `BANNED`
(подтверждено T&S). `BASIC`-канал не принимает донаты-с-текстом и не индексируется публично.

> **Один канал на кошелёк (ядро v0.1).** `ownerAddress` уникален среди активных каналов (ADR
> `decisions/0002`). Студия не имеет селектора каналов. Мультиканальность — за рамками ядра.

---

## 4. Конфиг канала

> Курс репутации ФИКСИРОВАН: `1 USDC = 1 очко` (ADR 0007), не настраивается. Поэтому нет
> `ReputationConfig`/`Curve`/`Multiplier`/`Decay` и нет версионирования формулы. Стример настраивает
> только тиры/пороги (`Tier.threshold`) и прочие параметры ниже.

```ts
interface Tier {
  name: string;
  threshold: Points;          // порог в очках
  color: string;              // цвет ника
  badge: string;              // id/ключ бейджа
  perks: Perk[];
}

interface Perk { label: string; condition?: string }   // в ядре — флаги/описания

interface ChannelConfig {
  channelId: string;
  version: number;            // метаданные (курс репутации фиксирован, не версионируется)
  hash: string;
  tiers: Tier[];
  minDonation: MicroUSDC;          // обычный донат
  minDonationWithText: MicroUSDC;  // донат-с-текстом (раздельно)
  messageMaxLen: number;
  profanityPolicy: "mask" | "hide" | "queue";
  nameMode: "addresses_only" | "allow_display_names";
  textShowMode: "manual" | "auto_if_clean";
  overlay: OverlaySettings;
  moderators: ModeratorRef[];
  updatedAt: Iso;
}

interface OverlaySettings {
  style: string; sound: boolean; minAmountToShow: MicroUSDC; tts: boolean;
}

interface ModeratorRef { address: Address; scope: "queue" | "queue_and_block" }
```

> **Очки:** при создании события DONATION пишется `points_delta = round(amount_usdc)` (фиксировано,
> ADR 0007). Тиры/пороги и косметика — чистая презентация, меняются свободно и применяются к текущему
> числу очков (прошлое не пересчитывается).

---

## 5. Журнал репутации (источник истины)

Апенд-онли. Репутация = детерминированная свёртка журнала через движок.

```ts
type LedgerType =
  | "DONATION"      // (+) единственный источник роста в ядре
  | "DISPUTE_WON"   // (+) выигранный спор (игра escrow-task)
  | "DISPUTE_LOST"  // (−) проигранный ложный спор — ЕДИНСТВЕННОЕ списание (протокол, не оператор; CR-1)
  | "GAME" | "REFUND"; // зарезервировано под будущие игры / возврат

interface LedgerEvent {
  id: string;
  donor: Address;
  creator: string;            // channelId
  type: LedgerType;
  amount: MicroUSDC;          // сумма доната (0 для не-донатных)
  pointsDelta: Points;        // вклад в репутацию (+/−)
  configVersion: number;      // по какой версии конфига забанковано
  txSignature?: TxSignature;  // Фаза 3
  ts: Iso;
}
```

Производная (вычисляемая, не хранимая как истина):

```ts
interface ViewerStanding {     // «моя репутация на этом канале»
  channelId: string;
  donor: Address;
  points: Points;              // движок(journal[donor,channel], config)
  tier: Tier;
  nextTier?: Tier;
  progressToNext: number;      // 0..1
  totalDonated: MicroUSDC;
  firstDonationAt?: Iso;
}
```

> `getStanding` возвращает `null`, если у адреса **нет событий** на канале (ни разу не донатил). Тогда
> UI рисует нулевого «Новичка» из `tiers[0]` конфига; страница `/me` пропускает каналы с `null`. Это
> упрощает чтение: «нет истории» и «нулевая репутация» — разные состояния, но оба валидны.

---

## 6. Донат и сообщение

```ts
type MessageState = "HELD" | "SHOWN" | "HIDDEN" | "QUARANTINED";
type ModerationVerdict = "CLEAR" | "FLAG" | "HARD_BLOCK";

interface Donation {
  id: string;                 // donation_id (идёт в memo)
  channelId: string;
  donor: Address;
  amount: MicroUSDC;          // полная сумма (до расщепления)
  feeAmount: MicroUSDC;       // ~3% в трежери
  netToStreamer: MicroUSDC;   // ~97%
  txSignature?: TxSignature;  // Фаза 3
  final: true;                // в ядре всегда true
  ts: Iso;
  message?: MessageRef;       // опц. текст
}

interface MessageRef {
  id: string;                 // msg_ref (идёт в memo)
  donationId: string;
  channelId: string;
  text: string;               // оффчейн, снимаемо
  lang?: string;              // детект языка
  state: MessageState;        // дефолт HELD
  autoVerdict?: ModerationVerdict;
  contentHash: string;        // для дедупа и опц. ончейн-якоря
  shownAt?: Iso;
  createdAt: Iso;
}
```

---

## 7. Баны и блокировки

```ts
interface ChannelBlock {        // канальный (стример), не платформенный
  channelId: string;
  blockedAddress: Address;
  reason?: string;
  byModerator: Address;
  ts: Iso;
}

type PenaltyAction =            // ADMIN_VOID убран (CR-1): оператор репутацию не редактирует
  | "HIDE_MESSAGE" | "CHANNEL_BLOCK" | "SUSPEND_CHANNEL"
  | "BAN_CREATOR_ROLE" | "BAN_WALLET_FULL" | "REINSTATE_CHANNEL";

interface OperatorAction {       // платформенный уровень (T&S)
  id: string;
  action: PenaltyAction;
  targetChannelId?: string;
  targetAddress?: Address;
  reason: string;                // CSAM / flood / sanctions / repeat_tos
  byOperator: Address;
  preservation?: boolean;        // сохранение материала для правоохранителей
  reported?: boolean;            // репорт в NCMEC и т.п.
  ts: Iso;
}

interface IncidentLog {
  id: string;
  channelId?: string;
  address?: Address;
  kind: "report" | "hard_block" | "sanction_hit" | "flood";
  detail: string;
  resolution?: string;
  ts: Iso;
}
```

---

## 8. Лидерборд (производная)

```ts
type LeaderboardPeriod = "all_time" | "month" | "top_donor_month";

interface LeaderboardEntry {
  rank: number;
  donor: Address;
  displayName?: string;
  points: Points;
  tier: Tier;
  totalDonated: MicroUSDC;
}
```

---

## 9. Что хранится где

| Данные | Ончейн | Оффчейн |
|--------|:------:|:-------:|
| Сумма доната, адреса, таймстамп | ✅ | (зеркало) |
| memo-атрибуция | ✅ | — |
| Хэш текста (опц.) | ✅ | — |
| Текст сообщения | — | ✅ (снимаемо) |
| Журнал репутации | — | ✅ |
| Конфиг канала | — | ✅ (хэш опц. ончейн) |
| Профили, тиры, лидерборды | — | ✅ |
| Баны, карантин, инцидент-лог | — | ✅ |

PII не собираем по умолчанию (адрес-онли). Профиль — opt-in. Retention для чистого контента короткий;
карантин — отдельная политика (`legal-and-risk.md`).
