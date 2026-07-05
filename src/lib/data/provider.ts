import type {
  Address,
  Channel,
  ChannelBlock,
  ChannelCard,
  ChannelConfig,
  ConfigPatch,
  CreateChannelInput,
  DonationInput,
  DonationResult,
  Donation,
  DonorOverview,
  GameRequest,
  HomeFeed,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  Page,
  Session,
  ViewerStanding,
} from "./types";
import type { DisputeParamsInfo, DisputeParamsValues } from "../chain/dispute-params";
import type { CanisterDisputeView } from "../chain/dispute-vote";
import { MockDataProvider } from "./mock-provider";
import { ApiDataProvider } from "./api-provider";

/**
 * Result<T> — асинхронный результат, который БРОСАЕТ Error при сбое (TanStack Query ловит).
 * (В mock-data.md записан как `Result<T> = T` ради читаемости сигнатур; на практике это Promise.)
 */
export type Result<T> = Promise<T>;

export type DataSource = "mock" | "api" | "chain" | "icp";

/**
 * Единственный интерфейс доступа к данным (frontend/mock-data.md §1, CLAUDE.md §3).
 * Ни один компонент не зовёт fetch/RPC/Solana — только методы отсюда через хуки.
 */
export interface DataProvider {
  // — Сессия / идентичность —
  getSession(): Result<Session>;
  connect(): Result<Session>; // Фаза 3: wallet-adapter + SIWS
  disconnect(): Result<void>;
  getProfile(address: Address): Result<LightProfile | null>;
  updateProfile(patch: Partial<LightProfile>): Result<LightProfile>;

  // — Дискавери / каналы —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>>; // только ACTIVE, публичные
  getChannel(handle: string): Result<Channel | null>;
  getMyChannel(): Result<Channel | null>; // канал, которым ВЛАДЕЕТ текущая сессия (один на кошелёк, ADR 0002)
  getManagedChannels(): Result<Channel[]>; // каналы, которыми управляешь: владелец ИЛИ модератор (для очереди)
  getOperatorChannels(): Result<Channel[]>; // ВСЕ каналы (любой статус) — только оператор (консоль T&S)
  getChannelConfig(channelId: string): Result<ChannelConfig>;
  createChannel(input: CreateChannelInput): Result<Channel>; // один канал на кошелёк (ADR 0002)
  activateChannel(channelId: string): Result<Channel>; // сбор ~$2 → BASIC→ACTIVE
  // H1: закрепить payout существующего канала ed25519-подписью владельца (каналы, созданные до
  // аттестаций). chain-провайдер подписывает кошельком сам (параметр игнорирует); mock/api требуют подпись.
  attestPayout(channelId: string, signatureB64?: string): Result<Channel>;
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig>;

  // — Репутация / статус —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null>;
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]>;
  // Агрегат по донору для публичного профиля /u/[address]: standing по каналам + активность (read-only).
  getDonorOverview(address: Address): Result<DonorOverview>;
  // Лента главной (ADR 0018): свои открытые циклы + что кипит. Личность — из сессии на сервере (не параметр),
  // иначе можно было бы прочитать чужой приватный текст задания (§4.6).
  homeFeed(): Result<HomeFeed>;

  // — Governance-параметры споров (миграция M1, ADR 0021) — ОПЦИОНАЛЬНЫ: канон живёт в
  // core-канистре ICP, методы есть только у IcpDataProvider (режим icp). UI проверяет наличие.
  getDisputeParams?(channelId: string): Result<DisputeParamsInfo>;
  // Спор по chain-задаче ИЗ КАНИСТРЫ (M2): открытое табло/голоса/вердикт/ончейн-подписи
  // резолвера. null = спора нет (или задача без эскроу). Открытие/голос идут через gameAction
  // (raiseDispute/vote) — IcpDataProvider сам маршрутизирует их в канистру подписью кошелька.
  getCanisterDispute?(channelId: string, taskId: string): Result<CanisterDisputeView | null>;
  // Запись = подпись кошельком владельца канонического сообщения (chain/dispute-params.ts) —
  // право на запись проверяет КАНИСТРА по владельцу-из-цепочки, сервер не участвует.
  setDisputeParams?(channelId: string, params: DisputeParamsValues): Result<DisputeParamsInfo>;

  // — Донаты —
  createDonation(input: DonationInput): Result<DonationResult>;
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>>;

  // — Модерация (стример/модераторы) —
  getModerationQueue(channelId: string): Result<MessageRef[]>;
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef>;
  // Скрыть ВСЕ сообщения донора на канале (одной кнопкой). Деньги/standing не трогаются — только показ.
  hideDonorMessages(channelId: string, donor: Address): Result<{ hidden: number }>;
  // Жалоба зрителя на показанный текст (любой вошедший); порог жалоб авто-скрывает + инцидент в T&S.
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }>;

  // — Канальный блок-лист (стример) —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]>;
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock>;
  removeChannelBlock(channelId: string, address: Address): Result<void>;
  // Донор: заблокирован ли Я на этом канале (+причина) — для плашки в карточке доната.
  getMyChannelBlock(channelId: string): Result<ChannelBlock | null>;

  // — Оператор / T&S (платформенный уровень) —
  getOperatorQueue(): Result<IncidentLog[]>;
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction>;

  // — Мини-игры: один game-bus на все игры (ADR 0016), интерфейс не растёт на каждую. Маршрутизация по
  //   gameId/op — на слое игр; результат типизируется хуками внутри модуля игры. —
  gameAction(req: GameRequest): Result<unknown>; // мутации
  gameQuery(req: GameRequest): Result<unknown>; // чтения
}

// — Доменные ошибки (бросаются провайдером, ловятся UI) —
export class DataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export const ErrChannelAlreadyExists = new DataError(
  "CHANNEL_ALREADY_EXISTS",
  "У этого кошелька уже есть канал (один канал на кошелёк).",
);
export const ErrTextRequiresActiveChannel = new DataError(
  "TEXT_REQUIRES_ACTIVE_CHANNEL",
  "Донат с текстом доступен только на активированном канале.",
);

/**
 * Выбор реализации по ENV-флагу (CLAUDE.md §3). Переход между фазами =
 * добавить реализацию интерфейса, не трогая экраны.
 */
export function createDataProvider(source: string | undefined): DataProvider {
  const s = (source ?? "mock") as DataSource;
  switch (s) {
    case "mock":
      return new MockDataProvider();
    case "api":
      return new ApiDataProvider();
    case "chain":
    case "icp":
      // Chain/IcpDataProvider РЕАЛИЗОВАНЫ, но включаются отдельным путём (app/providers.tsx →
      // chain-providers.tsx, динамический chunk: Solana-стек не попадает в bundle mock/api, ADR 0004).
      // Через эту фабрику они не инстанцируются намеренно — она для серверного/SSR-пути, где кошелька нет.
      throw new DataError(
        "CHAIN_VIA_PROVIDERS",
        "chain/icp-провайдер подключается в app/providers.tsx (ADR 0004).",
      );
    default:
      throw new DataError("BAD_DATA_SOURCE", `Неизвестный NEXT_PUBLIC_DATA_SOURCE: ${source}`);
  }
}
