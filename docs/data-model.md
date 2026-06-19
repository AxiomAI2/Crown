# Модель данных

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

## 4. Конфиг канала (версионируемый, хэшируемый)

```ts
type Curve =
  | { kind: "linear"; pointsPerUSDC: number }            // дефолт: 100
  | { kind: "sublinear"; alpha: number }                 // amount^alpha
  | { kind: "bracket"; brackets: Bracket[] };            // анти-плутократия

interface Bracket { upToUSDC: number | null; rate: number } // null = и выше

interface Multiplier { kind: "first_donation" | "streak" | "event"; factor: number }

interface DecayConfig { enabled: boolean; halfLifeDays?: number } // дефолт enabled:false

interface ReputationConfig {
  curve: Curve;
  multipliers: Multiplier[];
  decay: DecayConfig;
}

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
  version: number;
  hash: string;               // хэш версии конфига (проверяемость §arch)
  reputation: ReputationConfig;
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

> **Банкинг:** при создании события DONATION в журнал пишется `config_version`, по которому посчитаны
> очки. Последующая смена `curve`/rate **не** пересчитывает прошлые события (защита от рагпулла статуса).
> Тиры и косметика — чистая презентация, меняются свободно и применяются к текущему числу очков.

---

## 5. Журнал репутации (источник истины)

Апенд-онли. Репутация = детерминированная свёртка журнала через движок.

```ts
type LedgerType =
  | "DONATION"      // (+) единственный источник роста в ядре
  | "ADMIN_VOID"    // (−) списание оператором при нелегальщине
  // зарезервировано под игры — НЕ используется в ядре:
  | "DISPUTE_WON" | "DISPUTE_LOST" | "GAME" | "REFUND";

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

type PenaltyAction =
  | "HIDE_MESSAGE" | "CHANNEL_BLOCK" | "SUSPEND_CHANNEL"
  | "BAN_CREATOR_ROLE" | "BAN_WALLET_FULL" | "ADMIN_VOID";

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
