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
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  OverlayEvent,
  Page,
  Session,
  ViewerStanding,
} from "./types";
import { MockDataProvider } from "./mock-provider";
import { ApiDataProvider } from "./api-provider";

/**
 * Result<T> — асинхронный результат, который БРОСАЕТ Error при сбое (TanStack Query ловит).
 * (В mock-data.md записан как `Result<T> = T` ради читаемости сигнатур; на практике это Promise.)
 */
export type Result<T> = Promise<T>;

export type DataSource = "mock" | "api" | "chain";

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
  getMyChannel(): Result<Channel | null>; // канал текущей сессии (один на кошелёк, ADR 0002)
  getChannelConfig(channelId: string): Result<ChannelConfig>;
  createChannel(input: CreateChannelInput): Result<Channel>; // один канал на кошелёк (ADR 0002)
  activateChannel(channelId: string): Result<Channel>; // сбор ~$2 → BASIC→ACTIVE
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig>;

  // — Репутация / статус —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null>;
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]>;

  // — Донаты —
  createDonation(input: DonationInput): Result<DonationResult>;
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>>;

  // — Модерация (стример/модераторы) —
  getModerationQueue(channelId: string): Result<MessageRef[]>;
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef>;

  // — Канальный блок-лист (стример) —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]>;
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock>;
  removeChannelBlock(channelId: string, address: Address): Result<void>;

  // — Оператор / T&S (платформенный уровень) —
  getOperatorQueue(): Result<IncidentLog[]>;
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction>;
  getIncidentLog(opts?: ListOpts): Result<Page<IncidentLog>>;

  // — Оверлей (read-only поток для OBS) —
  subscribeOverlay(channelId: string, cb: (e: OverlayEvent) => void): () => void;
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
      // ChainDataProvider РЕАЛИЗОВАН, но включается отдельным путём (app/providers.tsx → chain-providers.tsx,
      // динамический chunk: Solana-стек не попадает в bundle mock/api, ADR 0004). Через эту фабрику он не
      // инстанцируется намеренно — она для серверного/SSR-пути, где кошелька нет.
      throw new DataError("CHAIN_VIA_PROVIDERS", "chain-провайдер подключается в app/providers.tsx (ADR 0004).");
    default:
      throw new DataError("BAD_DATA_SOURCE", `Неизвестный NEXT_PUBLIC_DATA_SOURCE: ${source}`);
  }
}
