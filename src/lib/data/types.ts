/**
 * Канонические типы ядра (docs/data-model.md). Используются и фронтом (форма мок-данных),
 * и позже бэкендом (схема БД). Деньги — micro-USDC (bigint), очки — целые.
 * UI-специфичные типы (Session, DonationInput, ChannelCard, ...) — из frontend/mock-data.md §1.
 */

// — Базовые типы —
export type Address = string; // Solana base58, напр. "7xKp...3fQa"
export type MicroUSDC = bigint; // 1 USDC = 1_000_000n
export type Points = number; // целые очки репутации
export type Iso = string; // ISO-8601 timestamp
export type TxSignature = string; // подпись транзакции Solana (Фаза 3)

// — Идентичность и профиль —
export type ProfileLevel = "address_only" | "light" | "creator";

export interface LightProfile {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  links?: ChannelLink[]; // ссылки на платформы (allowlist), как у канала — см. ChannelLink
}

// — Канал —
export type ChannelStatus = "BASIC" | "ACTIVE" | "SUSPENDED" | "BANNED";

export interface Channel {
  id: string; // creator_id
  ownerAddress: Address; // логин-адрес владельца (один канал на кошелёк — ADR 0002)
  payoutAddress: Address; // куда идут донаты (может != ownerAddress)
  handle: string; // публичный slug
  status: ChannelStatus; // BASIC до уплаты сбора активации
  activatedAt?: Iso;
  configVersion: number;
  createdAt: Iso;
}

// — Конфиг канала —
// Курс репутации ФИКСИРОВАН (1 USDC = 1 очко, ADR 0007), не настраивается. Стример настраивает только
// тиры/пороги (Tier.threshold) — сколько очков нужно для перков/участия в мини-играх.

export interface Perk {
  label: string;
  condition?: string;
}

export interface Tier {
  name: string;
  threshold: Points; // порог в очках
  color: string; // цвет ника
  badge: string; // id/ключ бейджа
  description?: string; // опц. описание тира (UGC; модерируется как описание канала; задел под перки/игры)
  perks: Perk[];
}

export interface ModeratorRef {
  address: Address;
  scope: "queue" | "queue_and_block";
}

// — Публичная личность канала —
// Платформа из фиксированного allowlist; url — каноничный https профиля/канала (валидируется доменом +
// шаблоном пути в lib/channel-links.ts: произвольный URL/глубокую ссылку вписать нельзя).
export type ChannelLinkPlatform =
  | "youtube"
  | "twitch"
  | "kick"
  | "x"
  | "tiktok"
  | "instagram"
  | "discord"
  | "telegram";

export interface ChannelLink {
  platform: ChannelLinkPlatform;
  url: string;
}

export interface ChannelConfig {
  channelId: string;
  version: number;
  hash: string; // версия конфига (метаданные; курс репутации фиксирован, не версионируется)
  // Имя канала и ссылки — НЕ здесь: единый источник истины — профиль владельца (LightProfile.displayName/
  // links по ownerAddress), чтобы у человека был один ник и один набор ссылок. Канальное — только описание
  // (тэглайн канала). Модерируется как UGC; инертно для репутации (формула не читает, §4.4).
  description?: string;
  tiers: Tier[];
  minDonation: MicroUSDC;
  minDonationWithText: MicroUSDC;
  messageMaxLen: number;
  profanityPolicy: "mask" | "hide" | "queue";
  nameMode: "addresses_only" | "allow_display_names";
  textShowMode: "manual" | "auto_if_clean";
  moderators: ModeratorRef[];
  updatedAt: Iso;
}

// — Журнал репутации (источник истины) —
export type LedgerType =
  | "DONATION" // (+) единственный источник роста в ядре
  | "ADMIN_VOID" // (−) списание оператором при нелегальщине
  // зарезервировано под игры — НЕ используется в ядре:
  | "DISPUTE_WON"
  | "DISPUTE_LOST"
  | "GAME"
  | "REFUND";

export interface LedgerEvent {
  id: string;
  donor: Address;
  creator: string; // channelId
  type: LedgerType;
  amount: MicroUSDC; // сумма доната (0 для не-донатных)
  pointsDelta: Points; // вклад в репутацию (+/−)
  configVersion: number; // по какой версии конфига забанковано
  txSignature?: TxSignature; // Фаза 3
  ts: Iso;
}

export interface ViewerStanding {
  channelId: string;
  donor: Address;
  points: Points;
  tier?: Tier; // undefined → очков меньше порога первого тира («без тира»)
  nextTier?: Tier;
  progressToNext: number; // 0..1
  totalDonated: MicroUSDC;
  firstDonationAt?: Iso;
}

// — Донат и сообщение —
export type MessageState = "HELD" | "SHOWN" | "HIDDEN" | "QUARANTINED";
export type ModerationVerdict = "CLEAR" | "FLAG" | "HARD_BLOCK";

export interface MessageRef {
  id: string; // msg_ref (идёт в memo)
  donationId: string;
  channelId: string;
  text: string; // оффчейн, снимаемо
  lang?: string;
  state: MessageState; // дефолт HELD
  autoVerdict?: ModerationVerdict;
  contentHash: string;
  shownAt?: Iso;
  createdAt: Iso;
}

export interface Donation {
  id: string; // donation_id (идёт в memo)
  channelId: string;
  donor: Address;
  amount: MicroUSDC; // полная сумма (до расщепления)
  feeAmount: MicroUSDC; // ~3% в трежери
  netToStreamer: MicroUSDC; // ~97%
  txSignature?: TxSignature; // Фаза 3
  final: true; // в ядре всегда true
  ts: Iso;
  message?: MessageRef;
  donorName?: string; // ник донора из лёгкого профиля (только для отображения; в журнал не пишется)
}

// — Баны и блокировки —
export interface ChannelBlock {
  channelId: string;
  blockedAddress: Address;
  reason?: string;
  byModerator: Address;
  ts: Iso;
}

export type PenaltyAction =
  | "HIDE_MESSAGE"
  | "CHANNEL_BLOCK"
  | "SUSPEND_CHANNEL"
  | "BAN_CREATOR_ROLE"
  | "BAN_WALLET_FULL"
  | "ADMIN_VOID"
  | "REINSTATE_CHANNEL"; // обратное к suspend/ban: SUSPENDED|BANNED → ACTIVE (путь восстановления)

export interface OperatorAction {
  id: string;
  action: PenaltyAction;
  targetChannelId?: string;
  targetAddress?: Address;
  reason: string; // CSAM / flood / sanctions / repeat_tos
  byOperator: Address;
  preservation?: boolean;
  reported?: boolean;
  ts: Iso;
}

export interface IncidentLog {
  id: string;
  channelId?: string;
  address?: Address; // адрес АВТОРА контента (донора) — на кого направлено действие
  kind: "report" | "hard_block" | "sanction_hit" | "flood";
  detail: string;
  text?: string; // оффенс-контент (за что инцидент); виден только оператору в /ops
  resolution?: string;
  ts: Iso;
}

// — Лидерборд (производная) —
export type LeaderboardPeriod = "all_time" | "month" | "top_donor_month";

export interface LeaderboardEntry {
  rank: number;
  donor: Address;
  displayName?: string;
  points: Points;
  tier?: Tier; // undefined → ниже порога первого тира
  totalDonated: MicroUSDC;
}

// — UI-специфичные типы (frontend/mock-data.md §1) —
export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface ListOpts {
  cursor?: string;
  limit?: number;
}

export interface Session {
  address: Address | null; // null = не подключён
  level: ProfileLevel;
  isCreator: boolean; // владеет каналом (один на кошелёк — ADR 0002)
  isOperator: boolean;
}

export interface DonationInput {
  channelId: string;
  amountUSDC: number; // ввод пользователя в USDC (UI); в micro конвертит провайдер
  text?: string; // опц.; на BASIC-канале → отклоняется
}

export interface DonationResult {
  donation: Donation;
  standing: ViewerStanding; // пересчитанная репутация донора СРАЗУ
  tierChanged: boolean; // для FinalityMoment / tier-up анимации
}

export interface ChannelCard {
  channelId: string;
  handle: string;
  displayName?: string; // имя владельца (из его профиля), не ник донора
  payoutAddress: Address; // кошелёк выплат — показываем + ссылка в проводник
  links?: ChannelLink[]; // соцсети владельца (мини-иконки)
  topTierName: string;
  donorsCount: number;
  totalDonated: MicroUSDC; // суммарный объём донатов (по лидерборду)
  activated: boolean; // ACTIVE → галочка; BASIC показывается, но без галочки и без донатов-с-текстом
  isLive?: boolean;
}

export interface CreateChannelInput {
  handle: string;
  payoutAddress: Address;
}

// — Профиль донатёра: агрегат по всем каналам (для публичной страницы /u/[address]) —
// ВАЖНО (инвариант §4.3): глобального рейтинга нет. Деньги агрегируемы (сумма донатов — факт), но
// очки репутации остаются ПОканальными — в overview суммы очков по каналам НЕ складываем.
export interface DonorChannelStanding {
  channelId: string;
  handle: string;
  channelName?: string; // имя владельца канала (его профиль), если задано
  tier?: Tier; // undefined → ниже порога первого тира
  points: Points; // локальная репутация в ЭТОМ канале
  totalDonated: MicroUSDC; // задонатил этому каналу
  donationCount: number;
  firstDonationAt?: Iso;
  lastDonationAt?: Iso;
}

// Событие журнала репутации донора для ленты «Активность»: за что НАЧИСЛИЛИ (+) или СПИСАЛИ (−) очки.
export interface DonorPointEvent {
  id: string;
  channelId: string;
  type: LedgerType; // в ядре: DONATION (+ за донат) | ADMIN_VOID (− списание оператором)
  pointsDelta: Points; // + начислено / − списано
  amount: MicroUSDC; // сумма доната (0 для списания)
  ts: Iso;
  txSignature?: TxSignature;
  message?: MessageRef; // приватный текст доната (если показан) — для строки активности
}

export interface DonorOverview {
  address: Address;
  totalDonated: MicroUSDC; // сумма по всем каналам (деньги — агрегируемы)
  donationCount: number;
  channelsSupported: number;
  firstDonationAt?: Iso; // «донатит с …» (самый ранний донат)
  topStanding?: DonorChannelStanding; // канал с наивысшими ЛОКАЛЬНЫМИ очками (для «высший тир», не глобал)
  ownedChannelHandle?: string; // если этот адрес ВЛАДЕЕТ каналом (один на кошелёк, ADR 0002) — его handle
  standings: DonorChannelStanding[]; // позиции по каналам (по убыванию суммы донатов)
  donations: Donation[]; // активность: все донаты по всем каналам, новые сверху (текст приватен до показа)
  pointEvents: DonorPointEvent[]; // журнал очков: за что начислили (+донат) / списали (−void), новые сверху
}

export type ConfigPatch = Partial<
  Pick<
    ChannelConfig,
    | "description"
    | "tiers"
    | "minDonation"
    | "minDonationWithText"
    | "messageMaxLen"
    | "profanityPolicy"
    | "nameMode"
    | "textShowMode"
    | "moderators"
  >
>;
