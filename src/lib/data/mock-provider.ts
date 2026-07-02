import { OPERATOR_ADDRESS, splitAmount } from "../chain/addresses";
import { verifyPayoutAttestation } from "../chain/attestation";
import { CHANNEL_DESC_MAX, sanitizeChannelLinks } from "../channel-links";
import { computePoints, computePointsAsOf, pointsForAmount, resolveTier } from "../reputation";
import { isLikelyBase58Address, toMicro } from "../utils";
import { dispatchGame, GAME_HANDLERS, GameBusError, type GameContext } from "../../games";
import { defaultChannelConfig, MAX_TIERS, TIER_DESC_MAX } from "./fixtures";
import { classifyTaskText, resolveAutoModerator, runPipeline, taskTextCommitment } from "./moderation";
import {
  DataError,
  ErrChannelAlreadyExists,
  ErrTextRequiresActiveChannel,
  type DataProvider,
  type Result,
} from "./provider";
import type {
  Address,
  Channel,
  ChannelBlock,
  ChannelCard,
  ChannelConfig,
  ConfigPatch,
  CreateChannelInput,
  Donation,
  DonationInput,
  DonationResult,
  GameRequest,
  DonorChannelStanding,
  DonorOverview,
  DonorPointEvent,
  HomeFeed,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LedgerEvent,
  LightProfile,
  ListOpts,
  LiveChannel,
  MessageRef,
  ModerationVerdict,
  OpenCycle,
  OperatorAction,
  Page,
  Session,
  ViewerStanding,
} from "./types";
import { WINDOWS } from "../../games/escrow-task/machine";
import type { EscrowTask } from "../../games/escrow-task/types";

const FAILABLE = new Set([
  "listChannels",
  "getChannel",
  "getMyChannel",
  "getStanding",
  "getLeaderboard",
  "listDonations",
  "getModerationQueue",
  "getChannelBlocklist",
  "getOperatorQueue",
]);

// R6 (ADR 0012): верхняя граница кэша дедупа модерации (in-memory стенд-ин под Postgres). При переполнении
// вытесняем старейшие записи (Map хранит порядок вставки) — повтор вытесненного контента просто
// будет переоценён заново, корректности не ломает.
const MOD_CACHE_CAP = 5000;

/**
 * In-memory backend-store. Личность — РЕАЛЬНЫЙ адрес кошелька (Фаза 3): нет фикстур и dev-личностей,
 * каналы создают пользователи, ончейн-донаты принимаются через recordDonationFromChain (после валидации
 * сервером из цепочки). Репутация считается общим движком lib/reputation.ts. Persistence — in-memory
 * (стенд-ин под Postgres; сбрасывается при перезапуске процесса).
 *
 * `createDonation` (оффчейн-симуляция) оставлен для api/mock без кошелька; в режиме chain деньги идут
 * ончейн, а зачёт делает ingest по подписи.
 */
/** Жалоба зрителя на показанный текст (анти-накрутка: одна на пару messageId+reporter). */
interface ReportRecord {
  messageId: string;
  channelId: string;
  reporter: Address;
  reason?: string;
  ts: string;
}

/** Сколько уникальных жалоб авто-скрывает показанный текст (до решения стримера/оператора). */
const REPORT_HIDE_THRESHOLD = 3;

// Лимиты длины пользовательского ввода (анти-DoS + аккуратные поверхности). Имя/био — ещё и публичны.
const PROFILE_LIMITS = { name: 40, bio: 280 };
const REASON_MAX = 500; // причина жалобы/операторского действия/блока (свободный текст)

/**
 * Сериализуемый снимок состояния стора для файловой персистентности (server/persist.ts, ADR 0013).
 * Map → entries; bigint переживает через codec. Не входят: sessionAddress/failMode/latencyScale (runtime),
 * резолвер личности.
 */
export interface StoreSnapshot {
  channelsById: [string, Channel][];
  handleToId: [string, string][];
  configsByChannel: [string, ChannelConfig[]][];
  profiles: [Address, LightProfile][];
  ledger: LedgerEvent[];
  donations: Donation[];
  messages: [string, MessageRef][];
  blocks: ChannelBlock[];
  incidents: IncidentLog[];
  operatorActions: OperatorAction[];
  modCache: [string, ModerationVerdict][];
  reports: ReportRecord[];
  gameState: [string, unknown][]; // состояние мини-игр (gameId → непрозрачный слайс; ADR 0016)
  seq: number;
}

export class MockDataProvider implements DataProvider {
  private channelsById = new Map<string, Channel>();
  private handleToId = new Map<string, string>();
  private configsByChannel = new Map<string, ChannelConfig[]>();
  private profiles = new Map<Address, LightProfile>();
  private ledger: LedgerEvent[] = [];
  private donations: Donation[] = [];
  private messages = new Map<string, MessageRef>();
  private blocks: ChannelBlock[] = [];
  private incidents: IncidentLog[] = [];
  private operatorActions: OperatorAction[] = [];
  private reports: ReportRecord[] = [];
  // Операторские override-наборы (модерация платформы). Не персистятся напрямую — ВЫЧИСЛЯЮТСЯ из
  // operatorActions (журнал = источник истины, он в снапшоте) через rebuildOperatorOverrides() в __restore.
  // Тейкдаун контента (задание/сообщение) и полный бан кошелька перебивают офчейн-логику; деньги ончейн это
  // не трогает (§4.1/§4.2 некастодиальность) — только видимость и офчейн-действия платформы.
  private operatorBlockedContent = new Set<string>();
  private bannedWallets = new Set<Address>();

  // H1: в chain-режиме канал без валидной подписи payout не создаётся (fail-closed). Флаг выставляет
  // server/store.ts по CHAIN_MODE (серверный env) — сам класс изоморфен и серверных флагов не знает.
  requirePayoutAttestation = false;

  private sessionAddress: Address | null = null;
  // H3: на сервере личность инжектится резолвером (per-request AsyncLocalStorage, см. server/store.ts);
  // в браузерном mock резолвера нет → читается sessionAddress (его выставляет __setAddress: кошелёк/dev).
  private identityResolver: (() => Address | null) | null = null;
  private failMode = process.env.NEXT_PUBLIC_MOCK_FAIL === "on";
  private latencyScale = 1;
  private seq = 0;
  private modCache = new Map<string, ModerationVerdict>();
  // Состояние мини-игр: непрозрачный для ядра слайс на каждую игру (форму владеет сама игра; ADR 0016).
  // Входит в снимок и БД (таблица game_state) — переживает рестарт, как и остальной стор.
  private gameState = new Map<string, unknown>();

  // — Инфраструктура —
  private now(): string {
    return new Date().toISOString();
  }
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.now()}-${this.seq}`;
  }
  private async gate(method: string): Promise<void> {
    // На сервере latencyScale=0 и failMode выкл → ни задержки, ни инъекции сбоев: пропускаем всю работу
    // (R8/ADR 0012). Личность несётся per-request через AsyncLocalStorage (ADR 0010), не перетирая чужую.
    if (this.latencyScale === 0 && !this.failMode) return;
    let h = 0;
    for (const ch of method) h = (h * 31 + ch.charCodeAt(0)) % 997;
    const ms = (120 + (h / 997) * 380) * this.latencyScale;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    if (this.failMode && FAILABLE.has(method)) {
      throw new DataError("MOCK_FAIL", `Сбой (${method}) — для проверки error-стейтов.`);
    }
  }
  private latestConfig(channelId: string): ChannelConfig {
    const list = this.configsByChannel.get(channelId);
    const last = list?.[list.length - 1];
    if (!last) throw new DataError("NO_CONFIG", `Нет конфига канала ${channelId}`);
    return last;
  }
  private eventsFor(donor: Address, channelId: string) {
    return this.ledger.filter((e) => e.donor === donor && e.creator === channelId);
  }
  /** Личность запроса: резолвер (сервер, per-request) или поле sessionAddress (браузерный mock). */
  private currentAddress(): Address | null {
    return this.identityResolver ? this.identityResolver() : this.sessionAddress;
  }
  private session(): Session {
    const address = this.currentAddress();
    if (!address)
      return { address: null, isCreator: false, isOperator: false };
    const isCreator = [...this.channelsById.values()].some((c) => c.ownerAddress === address);
    // C2: пустой OPERATOR_ADDRESS (prod без явного env) не должен давать прав оператора.
    const isOperator = Boolean(OPERATOR_ADDRESS) && address === OPERATOR_ADDRESS;
    return { address, isCreator, isOperator };
  }

  // — Авторизация. Личность = ПРОВЕРЕННЫЙ адрес сессии (выставлен из токена SIWS, см. server/auth.ts).
  // До этих проверок любой мог слать `address` в теле и выдавать себя за оператора/владельца (дыра C1/C3).
  private requireSession(): Address {
    const addr = this.currentAddress();
    if (!addr) throw new DataError("NO_SESSION", "Сначала подключи кошелёк и войди (подпись).");
    return addr;
  }
  private requireOperator(): Address {
    const addr = this.requireSession();
    // Пустой OPERATOR_ADDRESS (prod без явного env, C2) → оператора нет, отказываем всем (fail-closed).
    if (!OPERATOR_ADDRESS || addr !== OPERATOR_ADDRESS) {
      throw new DataError("FORBIDDEN", "Действие доступно только оператору платформы.");
    }
    return addr;
  }
  private channelOr404(channelId: string): Channel {
    const ch = this.channelsById.get(channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Канал не найден.");
    return ch;
  }
  private requireChannelOwner(channelId: string): Channel {
    const addr = this.requireSession();
    const ch = this.channelOr404(channelId);
    if (ch.ownerAddress !== addr) {
      throw new DataError("FORBIDDEN", "Только владелец канала может это сделать.");
    }
    return ch;
  }
  /** Владелец или модератор канала. needBlock → нужен скоуп queue_and_block (бан-операции). */
  private requireChannelManager(channelId: string, needBlock = false): Channel {
    const addr = this.requireSession();
    const ch = this.channelOr404(channelId);
    if (ch.ownerAddress === addr) return ch;
    const mod = this.latestConfig(channelId).moderators.find((m) => m.address === addr);
    if (!mod || (needBlock && mod.scope !== "queue_and_block")) {
      throw new DataError("FORBIDDEN", "Нужны права модератора этого канала.");
    }
    return ch;
  }
  /** Не бросает — для редакции приватного текста в публичных чтениях (инвариант §4.6). */
  private isChannelManager(channelId: string): boolean {
    const addr = this.currentAddress();
    if (!addr) return false;
    const ch = this.channelsById.get(channelId);
    if (!ch) return false;
    if (ch.ownerAddress === addr) return true;
    const cfg = this.configsByChannel.get(channelId)?.slice(-1)[0];
    return Boolean(cfg?.moderators.some((m) => m.address === addr));
  }
  /** Приватный текст (HELD/HIDDEN/QUARANTINED) виден только менеджерам канала; иначе вырезаем (§4.6). */
  private redactDonation(d: Donation, isManager: boolean): Donation {
    const m = d.message;
    if (!m) return d;
    // Операторский тейкдаун сообщения — снято с публикации для ВСЕХ, даже для менеджера канала (перебивает
    // роль). Иначе стример по-прежнему видел бы снятую оператором нелегальщину.
    if (this.operatorBlockedContent.has(m.id))
      return { ...d, message: { ...m, text: "", state: "HIDDEN" } };
    if (isManager || m.state === "SHOWN") return d;
    return { ...d, message: { ...m, text: "" } };
  }
  private standingFor(channelId: string, donor: Address): ViewerStanding | null {
    const events = this.eventsFor(donor, channelId);
    if (events.length === 0) return null;
    const cfg = this.latestConfig(channelId);
    const points = computePoints(events);
    const { tier, nextTier, progressToNext } = resolveTier(points, cfg.tiers);
    const donations = events.filter((e) => e.type === "DONATION");
    const totalDonated = donations.reduce((s, e) => s + e.amount, 0n);
    const firstDonationAt = donations.reduce<string | undefined>(
      (min, e) => (min && min < e.ts ? min : e.ts),
      undefined,
    );
    return {
      channelId,
      donor,
      points,
      tier,
      nextTier,
      progressToNext,
      totalDonated,
      firstDonationAt,
    };
  }

  // — Dev/инжект адреса (вне интерфейса) —
  __setAddress(address: Address | null) {
    this.sessionAddress = address;
  }
  /** H3: инжект резолвера личности (сервер). Браузерный mock не зовёт → остаётся поле sessionAddress. */
  __setIdentityResolver(resolver: (() => Address | null) | null) {
    this.identityResolver = resolver;
  }
  __getAddress(): Address | null {
    return this.sessionAddress;
  }
  __setFailMode(on: boolean) {
    this.failMode = on;
  }
  __getFailMode(): boolean {
    return this.failMode;
  }
  __setLatencyScale(scale: number) {
    this.latencyScale = scale;
  }
  __reset() {
    this.sessionAddress = null;
    this.failMode = false;
    this.latencyScale = 1;
    this.seq = 0;
    this.modCache.clear();
    this.channelsById.clear();
    this.handleToId.clear();
    this.configsByChannel.clear();
    this.profiles.clear();
    this.ledger = [];
    this.donations = [];
    this.messages.clear();
    this.blocks = [];
    this.incidents = [];
    this.operatorActions = [];
    this.reports = [];
    this.operatorBlockedContent.clear();
    this.bannedWallets.clear();
  }

  // — Персистентность (ADR 0013): снимок/восстановление для файлового хранилища (server/persist.ts) —
  __snapshot(): StoreSnapshot {
    return {
      channelsById: [...this.channelsById.entries()],
      handleToId: [...this.handleToId.entries()],
      configsByChannel: [...this.configsByChannel.entries()],
      profiles: [...this.profiles.entries()],
      ledger: this.ledger,
      donations: this.donations,
      messages: [...this.messages.entries()],
      blocks: this.blocks,
      incidents: this.incidents,
      operatorActions: this.operatorActions,
      modCache: [...this.modCache.entries()],
      reports: this.reports,
      gameState: [...this.gameState.entries()],
      seq: this.seq,
    };
  }
  __restore(s: StoreSnapshot) {
    this.channelsById = new Map(s.channelsById ?? []);
    this.handleToId = new Map(s.handleToId ?? []);
    this.configsByChannel = new Map(s.configsByChannel ?? []);
    this.profiles = new Map(s.profiles ?? []);
    this.ledger = s.ledger ?? [];
    this.donations = s.donations ?? [];
    this.messages = new Map(s.messages ?? []);
    this.blocks = s.blocks ?? [];
    this.incidents = s.incidents ?? [];
    this.operatorActions = s.operatorActions ?? [];
    this.modCache = new Map(s.modCache ?? []);
    this.reports = s.reports ?? [];
    this.gameState = new Map(s.gameState ?? []);
    this.seq = s.seq ?? 0;
    this.rebuildOperatorOverrides(); // тейкдаун/баны — из восстановленного журнала операторских действий
  }
  /** Пересобирает override-наборы (тейкдаун контента, полный бан кошелька) из журнала операторских действий —
   * единый источник истины (персистится), «последнее действие по цели побеждает». Канальные блоки живут в
   * this.blocks (персистятся отдельно) — тут их не трогаем. */
  private rebuildOperatorOverrides(): void {
    this.operatorBlockedContent.clear();
    this.bannedWallets.clear();
    for (const a of this.operatorActions) {
      if (a.action === "HIDE_MESSAGE" && a.targetContentId)
        this.operatorBlockedContent.add(a.targetContentId);
      else if (a.action === "BAN_WALLET_FULL" && a.targetAddress)
        this.bannedWallets.add(a.targetAddress);
      else if (a.action === "REINSTATE_CHANNEL") {
        if (a.targetContentId) this.operatorBlockedContent.delete(a.targetContentId);
        if (a.targetAddress && !a.targetChannelId) this.bannedWallets.delete(a.targetAddress);
      }
    }
  }
  /** Полный бан кошелька оператором: заблокированный не создаёт каналы, не донатит офчейн и не играет.
   * Деньги ончейн так не остановить (некастодиально) — гейт закрывает офчейн-действия платформы. */
  private requireNotBanned(addr: Address | null): void {
    if (addr && this.bannedWallets.has(addr))
      throw new DataError("WALLET_BANNED", "Кошелёк заблокирован оператором платформы.");
  }

  // — Сессия / идентичность —
  async getSession(): Result<Session> {
    await this.gate("getSession");
    return this.session();
  }
  async connect(): Result<Session> {
    await this.gate("connect");
    return this.session(); // адрес задаётся через __setAddress (кошелёк/dev)
  }
  async disconnect(): Result<void> {
    await this.gate("disconnect");
    this.sessionAddress = null;
  }
  async getProfile(address: Address): Result<LightProfile | null> {
    await this.gate("getProfile");
    return this.profiles.get(address) ?? null;
  }
  async updateProfile(patch: Partial<LightProfile>): Result<LightProfile> {
    await this.gate("updateProfile");
    const addr = this.session().address;
    if (!addr) throw new DataError("NO_SESSION", "Сначала подключи кошелёк.");
    // Лимиты длины (анти-DoS).
    if ((patch.displayName?.length ?? 0) > PROFILE_LIMITS.name)
      throw new DataError("TOO_LONG", `Имя — до ${PROFILE_LIMITS.name} символов.`);
    if ((patch.bio?.length ?? 0) > PROFILE_LIMITS.bio)
      throw new DataError("TOO_LONG", `О себе — до ${PROFILE_LIMITS.bio} символов.`);
    // Модерация ПУБЛИЧНЫХ полей (ник/био видны в ленте и лидерборде): запрещёнка/жёсткое → отказ. Мат — ок.
    const publicText = [patch.displayName, patch.bio].filter(Boolean).join(" ").trim();
    if (publicText && (await resolveAutoModerator().classify(publicText, "")) === "HARD_BLOCK")
      throw new DataError(
        "PROFILE_BLOCKED",
        "Профиль не прошёл модерацию (запрещённый/жёсткий контент).",
      );
    // Аватарки по URL отключены (канал для нецензурного контента) — не принимаем avatarUrl даже из прямого RPC.
    const { avatarUrl: _ignoredAvatar, ...safePatch } = patch;
    // Ссылки на платформы — только профиль/канал на доменах из allowlist (как у канала); чужой URL отброшен.
    if (patch.links !== undefined) safePatch.links = sanitizeChannelLinks(patch.links);
    const updated: LightProfile = {
      ...(this.profiles.get(addr) ?? { address: addr }),
      ...safePatch,
      avatarUrl: undefined,
      address: addr,
    };
    this.profiles.set(addr, updated);
    return updated;
  }

  // — Дискавери / каналы —
  async listChannels(_opts?: ListOpts): Result<Page<ChannelCard>> {
    await this.gate("listChannels");
    const items: ChannelCard[] = [...this.channelsById.values()]
      // Показываем и BASIC (без активации) — активация лишь разблокирует донат-с-текстом, а не сам показ.
      // Скрыты только SUSPENDED/BANNED.
      .filter((c) => c.status === "ACTIVE" || c.status === "BASIC")
      .map((c) => {
        const cfg = this.latestConfig(c.id);
        const board = this.computeLeaderboard(c.id, "all_time");
        const top = board[0];
        // Имя и ссылки канала = профиль ВЛАДЕЛЬЦА (единый ник/ссылки на человека), не отдельные канальные.
        const owner = this.profiles.get(c.ownerAddress);
        return {
          channelId: c.id,
          handle: c.handle,
          displayName: owner?.displayName,
          payoutAddress: c.payoutAddress,
          links: owner?.links,
          topTierName: top?.tier ? top.tier.name : (cfg.tiers[0]?.name ?? "Новичок"),
          donorsCount: board.length,
          totalDonated: board.reduce((s, e) => s + e.totalDonated, 0n),
          activated: c.status === "ACTIVE",
        };
      });
    return { items };
  }
  async getChannel(handle: string): Result<Channel | null> {
    await this.gate("getChannel");
    const id = this.handleToId.get(handle.trim().toLowerCase());
    return id ? (this.channelsById.get(id) ?? null) : null;
  }
  async getMyChannel(): Result<Channel | null> {
    await this.gate("getMyChannel");
    const addr = this.session().address;
    if (!addr) return null;
    return [...this.channelsById.values()].find((c) => c.ownerAddress === addr) ?? null;
  }
  /** Каналы, которыми текущая сессия управляет: владелец ИЛИ модератор (для очереди модерации). */
  async getManagedChannels(): Result<Channel[]> {
    await this.gate("getManagedChannels");
    const addr = this.session().address;
    if (!addr) return [];
    return [...this.channelsById.values()].filter((c) => {
      if (c.ownerAddress === addr) return true;
      const cfg = this.configsByChannel.get(c.id)?.slice(-1)[0];
      return Boolean(cfg?.moderators.some((m) => m.address === addr));
    });
  }
  /** ВСЕ каналы (любой статус) — для консоли оператора: нужно действовать и на SUSPENDED/BANNED. */
  async getOperatorChannels(): Result<Channel[]> {
    await this.gate("getOperatorChannels");
    this.requireOperator();
    return [...this.channelsById.values()];
  }
  /** Внутренний доступ для ingest (вне интерфейса). */
  __getChannelById(id: string): Channel | null {
    return this.channelsById.get(id) ?? null;
  }
  async getChannelConfig(channelId: string): Result<ChannelConfig> {
    await this.gate("getChannelConfig");
    return this.latestConfig(channelId);
  }
  async createChannel(input: CreateChannelInput): Result<Channel> {
    await this.gate("createChannel");
    const addr = this.requireSession();
    this.requireNotBanned(addr); // забаненный оператором кошелёк не заводит каналы
    // Валидация входов на денежном пути: кривой payout уронил бы сборку tx; handle нормализуем и
    // проверяем по строгому шаблону, уникальность — БЕЗ учёта регистра (анти-имперсонация @Foo/@foo).
    const handle = (input.handle ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
      throw new DataError("BAD_HANDLE", "Handle: 3–32 символа [a-z0-9_].");
    }
    if (!isLikelyBase58Address(input.payoutAddress)) {
      throw new DataError("BAD_PAYOUT", "payoutAddress не похож на Solana-адрес.");
    }
    if ([...this.channelsById.values()].some((c) => c.ownerAddress === addr))
      throw ErrChannelAlreadyExists;
    if (this.handleToId.has(handle)) {
      throw new DataError("HANDLE_TAKEN", `Handle @${handle} уже занят.`);
    }
    // H1: payout закрепляется ed25519-подписью владельца — сервер перестаёт быть источником истины по
    // адресу выплат (клиент донора проверяет подпись сам до сборки tx). Присланная подпись обязана быть
    // валидной в любом режиме; в chain-режиме её отсутствие — отказ (fail-closed).
    const attestation = input.payoutAttestation;
    if (attestation !== undefined && !verifyPayoutAttestation(addr, input.payoutAddress, attestation))
      throw new DataError("BAD_ATTESTATION", "Подпись адреса выплат не прошла проверку.");
    if (this.requirePayoutAttestation && !attestation)
      throw new DataError(
        "PAYOUT_UNATTESTED",
        "Нужна подпись адреса выплат кошельком владельца (attestPayout).",
      );
    const id = this.nextId("ch");
    const channel: Channel = {
      id,
      ownerAddress: addr,
      payoutAddress: input.payoutAddress,
      payoutAttestation: attestation,
      handle,
      status: "BASIC",
      configVersion: 1,
      createdAt: this.now(),
    };
    this.channelsById.set(id, channel);
    this.handleToId.set(handle, id);
    this.configsByChannel.set(id, [defaultChannelConfig(id)]);
    return channel;
  }
  async activateChannel(channelId: string): Result<Channel> {
    await this.gate("activateChannel");
    const ch = this.requireChannelOwner(channelId);
    const updated: Channel = { ...ch, status: "ACTIVE", activatedAt: this.now() };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  /**
   * Активация из ончейн-сбора (server/ingest.ts): без сессии — личность/право уже проверены сервером
   * (payer === ownerAddress). Идемпотентно: повторный приём той же tx не меняет уже активный канал.
   */
  activateFromChain(channelId: string): Channel | null {
    const ch = this.channelsById.get(channelId);
    if (!ch) return null;
    if (ch.status === "ACTIVE") return ch;
    const updated: Channel = { ...ch, status: "ACTIVE", activatedAt: this.now() };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  /** H1: дозакрепить payout СУЩЕСТВУЮЩЕГО канала подписью владельца (каналы, созданные до аттестаций). */
  async attestPayout(channelId: string, signatureB64?: string): Result<Channel> {
    await this.gate("attestPayout");
    const ch = this.requireChannelOwner(channelId);
    if (!signatureB64 || !verifyPayoutAttestation(ch.ownerAddress, ch.payoutAddress, signatureB64))
      throw new DataError("BAD_ATTESTATION", "Подпись адреса выплат не прошла проверку.");
    const updated: Channel = { ...ch, payoutAttestation: signatureB64 };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  async updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    await this.gate("updateChannelConfig");
    this.requireChannelOwner(channelId);
    const list = this.configsByChannel.get(channelId);
    const current = list?.[list.length - 1];
    if (!list || !current) throw new DataError("NO_CONFIG", "Нет конфига канала.");
    // Потолок числа тиров (анти-«бесконечный список»; страховка поверх UI).
    if (patch.tiers && patch.tiers.length > MAX_TIERS)
      throw new DataError("TOO_MANY_TIERS", `Тиров — не больше ${MAX_TIERS}.`);
    // Описания тиров (UGC, опц.) — тот же лимит-стиль и та же модерация, что у описания канала.
    if (patch.tiers) {
      for (const t of patch.tiers) {
        const d = t.description?.trim();
        if (!d) continue;
        if (d.length > TIER_DESC_MAX)
          throw new DataError("TOO_LONG", `Описание тира — до ${TIER_DESC_MAX} символов.`);
        if ((await resolveAutoModerator().classify(d, "")) === "HARD_BLOCK")
          throw new DataError(
            "CHANNEL_BLOCKED",
            "Описание тира не прошло модерацию (запрещённый/жёсткий контент).",
          );
      }
    }
    // §10: пороги репутации (задание/спор) — неотрицательные конечные числа, вменяемый потолок (страховка
    // поверх UI). Гейтят право присылать задание / поднимать спор, не вес и не исход.
    for (const [k, v] of [
      ["minReputationToTask", patch.minReputationToTask],
      ["minReputationToDispute", patch.minReputationToDispute],
    ] as const) {
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0 || v > 1_000_000_000)
        throw new DataError("BAD_CONFIG", `Порог репутации (${k}) — неотрицательное число.`);
    }
    // Описание канала (UGC): лимит + модерация. Имя/ссылки канала живут в профиле владельца, не здесь.
    if (patch.description !== undefined && patch.description.length > CHANNEL_DESC_MAX)
      throw new DataError("TOO_LONG", `Описание — до ${CHANNEL_DESC_MAX} символов.`);
    if (
      patch.description &&
      (await resolveAutoModerator().classify(patch.description, "")) === "HARD_BLOCK"
    )
      throw new DataError(
        "CHANNEL_BLOCKED",
        "Описание не прошло модерацию (запрещённый/жёсткий контент).",
      );
    // Курс репутации фиксирован → версионировать нечего. Тиры/минимумы/настройки применяются сразу.
    const updated: ChannelConfig = { ...current, ...patch, updatedAt: this.now() };
    list[list.length - 1] = updated;
    return updated;
  }

  // — Репутация / статус —
  async getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    await this.gate("getStanding");
    return this.standingFor(channelId, donor);
  }
  async getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    await this.gate("getLeaderboard");
    return this.computeLeaderboard(channelId, period);
  }
  /** Адреса, заблокированные на канале — для анти-публикации текста и анонимизации ника. */
  private blockedSet(channelId: string): Set<Address> {
    return new Set(
      this.blocks.filter((b) => b.channelId === channelId).map((b) => b.blockedAddress),
    );
  }
  private computeLeaderboard(channelId: string, period: LeaderboardPeriod): LeaderboardEntry[] {
    if (!this.configsByChannel.has(channelId)) return [];
    const cfg = this.latestConfig(channelId);
    const blocked = this.blockedSet(channelId);
    const monthAgo = Date.parse(this.now()) - 30 * 86_400_000;
    const inPeriod = (ts: string) => period === "all_time" || Date.parse(ts) >= monthAgo;
    const donors = new Set(
      this.ledger.filter((e) => e.creator === channelId && inPeriod(e.ts)).map((e) => e.donor),
    );
    const entries: LeaderboardEntry[] = [];
    for (const donor of donors) {
      const events = this.eventsFor(donor, channelId).filter((e) => inPeriod(e.ts));
      const points = computePoints(events);
      if (points <= 0) continue;
      const totalDonated = events
        .filter((e) => e.type === "DONATION")
        .reduce((s, e) => s + e.amount, 0n);
      entries.push({
        rank: 0,
        donor,
        // addresses_only ИЛИ заблокирован → имя не отдаём, UI покажет короткий адрес.
        displayName:
          cfg.nameMode === "allow_display_names" && !blocked.has(donor)
            ? this.profiles.get(donor)?.displayName
            : undefined,
        points,
        tier: resolveTier(points, cfg.tiers).tier,
        totalDonated,
      });
    }
    // §4.4 детерминизм: при равенстве очков ранг НЕ должен зависеть от порядка в журнале. Вторичные ключи —
    // больше задонатил, затем адрес (уникален) → полный порядок, перевычислимый независимо.
    entries.sort(
      (a, b) =>
        b.points - a.points ||
        (b.totalDonated > a.totalDonated ? 1 : b.totalDonated < a.totalDonated ? -1 : 0) ||
        a.donor.localeCompare(b.donor),
    );
    entries.forEach((e, i) => (e.rank = i + 1));
    return entries.slice(0, 50);
  }

  async getDonorOverview(address: Address): Result<DonorOverview> {
    await this.gate("getDonorOverview");
    // Все каналы, где у донора есть события (значит, есть standing). Обходим ledger напрямую — профиль
    // показывает ВСЮ историю донора, включая каналы вне дискавери (SUSPENDED/BANNED).
    const channelIds = new Set(
      this.ledger.filter((e) => e.donor === address).map((e) => e.creator),
    );
    const standings: DonorChannelStanding[] = [];
    for (const channelId of channelIds) {
      const s = this.standingFor(channelId, address);
      const ch = this.channelsById.get(channelId);
      if (!s || !ch) continue;
      const myDonations = this.donations.filter(
        (d) => d.channelId === channelId && d.donor === address,
      );
      const lastDonationAt = myDonations.reduce<string | undefined>(
        (max, d) => (max && max > d.ts ? max : d.ts),
        undefined,
      );
      standings.push({
        channelId,
        handle: ch.handle,
        channelName: this.profiles.get(ch.ownerAddress)?.displayName,
        tier: s.tier,
        points: s.points,
        totalDonated: s.totalDonated,
        donationCount: myDonations.length,
        firstDonationAt: s.firstDonationAt,
        lastDonationAt,
      });
    }
    // Позиции — по убыванию суммы донатов (как «по стоимости» у polymarket).
    standings.sort((a, b) =>
      b.totalDonated > a.totalDonated ? 1 : b.totalDonated < a.totalDonated ? -1 : 0,
    );

    // Активность: все донаты донора по всем каналам, новые сверху. Текст приватен (зритель не менеджер) → редактируем.
    const donations = this.donations
      .filter((d) => d.donor === address)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((d) => {
        const r = this.redactDonation(d, false);
        const donorName = this.profiles.get(d.donor)?.displayName;
        return donorName ? { ...r, donorName } : r;
      });

    // Журнал очков донора: за что НАЧИСЛИЛИ очки (донаты, рост репутации), новые сверху.
    // Лента активности донора — только донаты (рост репутации). Оператор репутацию не списывает (CR-1),
    // а протокольные спор-события (DISPUTE_*) живут в слое игры, не в этой ленте.
    const pointEvents: DonorPointEvent[] = donations
      .map((d) => ({
        id: d.id,
        channelId: d.channelId,
        type: "DONATION" as const,
        pointsDelta: pointsForAmount(d.amount),
        amount: d.amount,
        ts: d.ts,
        txSignature: d.txSignature,
        message: d.message,
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));

    const totalDonated = standings.reduce((sum, x) => sum + x.totalDonated, 0n);
    const firstDonationAt = donations.reduce<string | undefined>(
      (min, d) => (min && min < d.ts ? min : d.ts),
      undefined,
    );
    // «Высший тир» = канал с наибольшими ЛОКАЛЬНЫМИ очками. Это НЕ глобальный рейтинг (§4.3) — просто
    // лучшее достижение донора где-то, для бейджа. Очки по каналам не складываем.
    const topStanding = standings.reduce<DonorChannelStanding | undefined>(
      (best, x) => (!best || x.points > best.points ? x : best),
      undefined,
    );
    // Владеет ли этот адрес каналом (один на кошелёк, ADR 0002) — чтобы с профиля можно было перейти на канал.
    const ownedChannel = [...this.channelsById.values()].find((c) => c.ownerAddress === address);

    return {
      address,
      totalDonated,
      donationCount: donations.length,
      channelsSupported: standings.length,
      firstDonationAt,
      topStanding,
      ownedChannelHandle: ownedChannel?.handle,
      standings,
      donations,
      pointEvents,
    };
  }

  /**
   * Лента главной (ADR 0018): мои открытые эскроу-циклы (по срочности) + что кипит (по РАЗНЫМ участникам).
   * Личность — из СЕССИИ (не параметр): циклы несут ТВОЙ текст задания, читать чужой адрес нельзя (§4.6).
   * Пока учитывает игру `escrow-task` (единственную) — расширяемо на другие игры.
   */
  async homeFeed(): Result<HomeFeed> {
    await this.gate("homeFeed");
    const tasks =
      (this.gameState.get("escrow-task") as { tasks: EscrowTask[] } | undefined)?.tasks ?? [];
    const now = Date.parse(this.now());
    const address = this.currentAddress();
    const cycles: OpenCycle[] = [];
    if (address) {
      for (const t of tasks) {
        if (t.donor !== address) continue;
        const c = this.cycleOf(t, now);
        if (c) cycles.push(c);
      }
      // Срочность: «действуй сейчас» (claimable → окно закрывается) → «ждём других»; внутри — по дедлайну.
      const rank = (c: OpenCycle) => (c.kind === "claimable" ? 0 : c.actionable ? 1 : 2);
      cycles.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.deadline ? Date.parse(a.deadline) : 0) - (b.deadline ? Date.parse(b.deadline) : 0),
      );
    }
    return { cycles, live: this.liveChannels(tasks, now) };
  }

  /** Открытый цикл донора по задаче (null — цикл закрыт: ушёл стримеру / уже забран). */
  private cycleOf(t: EscrowTask, now: number): OpenCycle | null {
    const base = {
      taskId: t.id,
      channelId: t.channelId,
      channelHandle: this.channelsById.get(t.channelId)?.handle ?? t.channelId,
      amount: BigInt(t.amount),
      text: t.text,
    };
    switch (t.status) {
      case "RESOLVED": {
        const r = t.resolution;
        return r && r.outcome === "to_donor" && !r.claimed
          ? { ...base, kind: "claimable", actionable: true }
          : null;
      }
      case "DISPUTED":
        return { ...base, kind: "voting", deadline: t.dispute?.votingEndsAt, actionable: false };
      case "DONE":
        return { ...base, kind: "dispute_window", deadline: t.disputeWindowEndsAt, actionable: true };
      case "PENDING":
      case "ACCEPTED": {
        const graceEnd = Date.parse(t.createdAt) + WINDOWS.grace;
        return t.status === "PENDING" && now <= graceEnd
          ? { ...base, kind: "grace", deadline: new Date(graceEnd).toISOString(), actionable: true }
          : { ...base, kind: "awaiting", deadline: t.executionDeadline, actionable: false };
      }
      default:
        return null;
    }
  }

  /** Живые каналы для полоски: ранг по РАЗНЫМ участникам → velocity → активности (НЕ по сумме — §4.3/ADR 0018). */
  private liveChannels(tasks: EscrowTask[], now: number): LiveChannel[] {
    const RECENT_MS = 24 * 3_600_000;
    const agg = new Map<
      string,
      { handle: string; active: number; donors: Set<Address>; locked: bigint; velocity: number }
    >();
    for (const t of tasks) {
      if (t.status === "RESOLVED") continue; // не живой
      const ch = this.channelsById.get(t.channelId);
      if (!ch || ch.status !== "ACTIVE") continue; // только публичные активные
      const e = agg.get(t.channelId) ?? {
        handle: ch.handle,
        active: 0,
        donors: new Set<Address>(),
        locked: 0n,
        velocity: 0,
      };
      e.active += 1;
      e.donors.add(t.donor);
      e.locked += BigInt(t.amount);
      if (now - Date.parse(t.createdAt) <= RECENT_MS) e.velocity += 1;
      agg.set(t.channelId, e);
    }
    return [...agg.entries()]
      .sort(
        ([, a], [, b]) =>
          b.donors.size - a.donors.size || b.velocity - a.velocity || b.active - a.active,
      )
      .slice(0, 20)
      .map(([channelId, e]) => ({
        channelId,
        handle: e.handle,
        activeCount: e.active,
        participants: e.donors.size,
        lockedMicro: e.locked,
      }));
  }

  // — Донаты —
  /** Оффчейн-симуляция (api/mock без кошелька). В режиме chain не используется. */
  async createDonation(input: DonationInput): Result<DonationResult> {
    await this.gate("createDonation");
    const donor = this.session().address;
    if (!donor) throw new DataError("NO_SESSION", "Сначала подключи кошелёк, чтобы задонатить.");
    this.requireNotBanned(donor); // забаненный оператором кошелёк не донатит (офчейн-путь)
    const ch = this.channelsById.get(input.channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Канал не найден.");
    const cfg = this.latestConfig(input.channelId);
    const hasText = Boolean(input.text && input.text.trim());
    // B4: лимит длины текста (как трастлесс-приём в server/ingest.ts) — иначе мегабайтный текст осел бы в
    // сторе и каждый раз гонялся в OpenAI-модерацию (DoS/амплификация).
    if (hasText && input.text!.trim().length > cfg.messageMaxLen)
      throw new DataError("TOO_LONG", "Текст доната превышает лимит канала.");
    const amount = toMicro(input.amountUSDC);
    const min = hasText ? cfg.minDonationWithText : cfg.minDonation;
    if (amount < min) throw new DataError("BELOW_MIN", "Сумма ниже минимума канала.");
    if (hasText && ch.status !== "ACTIVE") throw ErrTextRequiresActiveChannel;
    if (
      hasText &&
      this.blocks.some((b) => b.channelId === input.channelId && b.blockedAddress === donor)
    ) {
      throw new DataError("BLOCKED", "Этот кошелёк заблокирован на канале для донатов-с-текстом.");
    }
    const { fee, net } = splitAmount(amount); // единый источник ставки (addresses.ts), не дублируем 3%
    return this.record({
      channelId: input.channelId,
      donor,
      amount,
      fee,
      net,
      text: hasText ? input.text!.trim() : undefined,
      textShowMode: cfg.textShowMode,
    });
  }

  /**
   * Запись ончейн-доната (после валидации сервером из цепочки). Идемпотентно по signature. `text` —
   * уже сверенный по хэшу из memo (см. server/ingest.ts); если донат уже принят без текста, а текст
   * пришёл позже (клиент/индексер в разном порядке) — привязываем сообщение к существующему донату.
   */
  async recordDonationFromChain(params: {
    signature: string;
    donor: Address;
    channelId: string;
    amountMicro: bigint;
    feeMicro: bigint;
    netMicro: bigint;
    text?: string;
  }): Promise<DonationResult | null> {
    // B1: сериализуем по подписи — дедуп ниже это «нашёл → await(модерация) → записал», и без очереди два
    // параллельных приёма одной подписи (клиентский RPC + опрос индексера) оба прошли бы find и записали
    // донат+репутацию дважды за один платёж. Очередь по подписи → второй увидит existing (дедуп/поздний текст).
    return this.runSerialized(this.ingestTails, params.signature, async () => {
      const existing = this.donations.find((d) => d.txSignature === params.signature);
      if (existing) {
        const blocked = this.blocks.some(
          (b) => b.channelId === existing.channelId && b.blockedAddress === existing.donor,
        );
        if (params.text && !existing.message && !blocked) {
          // Поздняя привязка текста к уже принятому донату (клиент/индексер пришли в разном порядке).
          await this.buildMessage(existing, params.text, this.now());
          const standing = this.standingFor(existing.channelId, existing.donor)!; // донат уже в журнале
          return { donation: existing, standing, tierChanged: false }; // R7 (ADR 0012): успех, а не null
        }
        return null; // дубль подписи без нового текста — идемпотентно, добавлять нечего
      }
      const ch = this.channelsById.get(params.channelId);
      if (!ch) return null;
      return this.record({
        channelId: params.channelId,
        donor: params.donor,
        amount: params.amountMicro,
        fee: params.feeMicro,
        net: params.netMicro,
        signature: params.signature,
        text: params.text,
        textShowMode: this.latestConfig(params.channelId).textShowMode,
      });
    });
  }

  /** Создаёт сообщение к донату: прогон модерации (async — авто-слой может ходить в OpenAI), дедуп,
   *  карантин-инцидент. Привязка donation.message. */
  private async buildMessage(donation: Donation, text: string, ts: string): Promise<MessageRef> {
    const cfg = this.latestConfig(donation.channelId);
    const { verdict, lang, contentHash, deduped } = await runPipeline(text, this.modCache, {
      scope: donation.channelId,
      auto: resolveAutoModerator(), // OpenAI при наличии OPENAI_API_KEY, иначе локальный словарь
    });
    while (this.modCache.size > MOD_CACHE_CAP) {
      const oldest = this.modCache.keys().next().value;
      if (oldest === undefined) break;
      this.modCache.delete(oldest);
    }
    const isHardBlock = verdict === "HARD_BLOCK";
    const autoShow = !isHardBlock && cfg.textShowMode === "auto_if_clean" && verdict === "CLEAR";
    const messageId = this.nextId("m");
    const message: MessageRef = {
      id: messageId,
      donationId: donation.id,
      channelId: donation.channelId,
      text,
      lang,
      state: isHardBlock ? "QUARANTINED" : autoShow ? "SHOWN" : "HELD",
      autoVerdict: verdict,
      contentHash,
      shownAt: autoShow ? ts : undefined,
      createdAt: ts,
    };
    this.messages.set(messageId, message);
    donation.message = message;
    if (isHardBlock && !deduped) {
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: donation.channelId,
        address: donation.donor, // автор контента — на кого действовать
        kind: "hard_block",
        detail: "Авто-карантин: запрещёнка в тексте доната.",
        text,
        ts,
      });
    }
    return message;
  }

  /** Общая запись доната: банкинг очков СРАЗУ, текст → HELD/модерация (инварианты §4). Async: модерация
   *  текста может ходить в OpenAI (см. buildMessage). Очки/журнал банкуются независимо от текста (§4.7). */
  private async record(p: {
    channelId: string;
    donor: Address;
    amount: bigint;
    fee: bigint;
    net: bigint;
    text?: string;
    textShowMode?: ChannelConfig["textShowMode"];
    signature?: string;
  }): Promise<DonationResult> {
    const cfg = this.latestConfig(p.channelId);
    // Канальный блок-лист: заблокированному кошельку донат-с-текстом не публикуем. Оффчейн createDonation
    // отклоняет заранее; в chain деньги ончейн финальны → донат принимаем, но ТЕКСТ режем (сообщение не создаём).
    const blocked = this.blocks.some(
      (b) => b.channelId === p.channelId && b.blockedAddress === p.donor,
    );
    const pointsDelta = pointsForAmount(p.amount); // фиксировано: 1 USDC = 1 очко
    const ts = this.now();
    const tierBefore = this.standingFor(p.channelId, p.donor)?.tier?.name;
    const donationId = this.nextId("d");
    const donation: Donation = {
      id: donationId,
      channelId: p.channelId,
      donor: p.donor,
      amount: p.amount,
      feeAmount: p.fee,
      netToStreamer: p.net,
      txSignature: p.signature,
      final: true,
      ts,
    };
    this.ledger.push({
      id: this.nextId("l"),
      donor: p.donor,
      creator: p.channelId,
      type: "DONATION",
      amount: p.amount,
      pointsDelta,
      configVersion: cfg.version,
      txSignature: p.signature,
      ts,
    });
    if (p.text && !blocked) await this.buildMessage(donation, p.text, ts);
    this.donations.push(donation);
    const standing = this.standingFor(p.channelId, p.donor)!;
    const tierChanged = tierBefore !== undefined && tierBefore !== standing.tier?.name;
    return { donation, standing, tierChanged };
  }

  /**
   * Префлайт текста доната ПЕРЕД отправкой ончейн (вне DataProvider; зовётся chain-слоем до подписи).
   * blocked=true только на HARD_BLOCK (запрещёнка/жёсткое) — как у ника. Мат разрешён → не блокируем.
   * Это не «решение о деньгах»: tx ещё не отправлена. Ingest всё равно проводит модерацию повторно (бэкстоп).
   */
  async precheckText(
    text: string,
    channelId?: string,
    kind: "message" | "task" = "message",
  ): Result<{ blocked: boolean; reason?: "content" | "blocklist" }> {
    await this.gate("precheckText");
    // Блок-лист канала: заблокированному кошельку донат-с-текстом нельзя — ловим ДО подписи (деньги не тратятся).
    const donor = this.session().address;
    if (
      channelId &&
      donor &&
      this.blocks.some((b) => b.channelId === channelId && b.blockedAddress === donor)
    ) {
      return { blocked: true, reason: "blocklist" };
    }
    const t = (text ?? "").trim();
    if (!t) return { blocked: false };
    // B4: не отправляем в модерацию неограниченный текст (DoS/амплификация OpenAI) — режем до лимита канала
    // (тот же текст потом всё равно капается в createDonation). Без канала — разумный потолок.
    const maxLen =
      channelId && this.configsByChannel.has(channelId)
        ? this.latestConfig(channelId).messageMaxLen
        : 2000;
    // ЗАДАНИЕ (escrow-task) оплачивается ончейн ДО записи → префлайт обязан судить ТОЙ ЖЕ строгой политикой,
    // что серверный create (classifyTaskText: + LLM-легальность), иначе слабый префлайт пропустит нелегальное
    // задание, эскроу профинансируется, а create отклонит → осиротевший эскроу (деньги заперты, задания нет).
    // Слишком длинное режем как блок ДО ИИ (не фандим). classifyTaskText мемоизируется по хэшу — тот же вход
    // → тот же вердикт на серверном create (недетерминизм ИИ не «перевернёт» решение после фандинга).
    if (kind === "task") {
      if (t.length > maxLen) return { blocked: true, reason: "content" };
      const verdict = await classifyTaskText(t);
      return verdict === "HARD_BLOCK" ? { blocked: true, reason: "content" } : { blocked: false };
    }
    const hard = (await resolveAutoModerator().classify(t.slice(0, maxLen), "")) === "HARD_BLOCK";
    return hard ? { blocked: true, reason: "content" } : { blocked: false };
  }

  async listDonations(channelId: string, _opts?: ListOpts): Result<Page<Donation>> {
    await this.gate("listDonations");
    const isManager = this.isChannelManager(channelId);
    // Режим имён канала: addresses_only → НЕ показываем ники (даже из профиля), только адреса.
    const showNames =
      this.configsByChannel.has(channelId) &&
      this.latestConfig(channelId).nameMode === "allow_display_names";
    // Заблокированные на канале — всегда только адресом, ник не показываем (даже при allow_display_names).
    const blocked = this.blockedSet(channelId);
    const items = this.donations
      .filter((d) => d.channelId === channelId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((d) => {
        const r = this.redactDonation(d, isManager);
        const donorName =
          showNames && !blocked.has(d.donor) ? this.profiles.get(d.donor)?.displayName : undefined;
        return donorName ? { ...r, donorName } : r;
      });
    return { items };
  }

  // — Модерация —
  async getModerationQueue(channelId: string): Result<MessageRef[]> {
    await this.gate("getModerationQueue");
    this.requireChannelManager(channelId); // приватный текст — только менеджерам (§4.6)
    return [...this.messages.values()]
      .filter((m) => m.channelId === channelId && m.state === "HELD")
      .sort((a, b) => {
        const af = a.autoVerdict === "FLAG" ? 0 : 1;
        const bf = b.autoVerdict === "FLAG" ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
  }
  async setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    await this.gate("setMessageState");
    const msg = this.messages.get(messageId);
    if (!msg) throw new DataError("NO_MESSAGE", "Сообщение не найдено.");
    this.requireChannelManager(msg.channelId); // показ/скрытие — решение публикации, только менеджер
    // Операторский тейкдаун перебивает стримера: снятое оператором сообщение он показать обратно не может.
    if (state === "SHOWN" && this.operatorBlockedContent.has(messageId))
      throw new DataError("BLOCKED_BY_OPERATOR", "Сообщение снято оператором платформы — показать нельзя.");
    const updated: MessageRef = {
      ...msg,
      state,
      shownAt: state === "SHOWN" ? this.now() : msg.shownAt,
    };
    this.messages.set(messageId, updated);
    const donation = this.donations.find((d) => d.id === msg.donationId);
    if (donation) donation.message = updated;
    return updated;
  }
  /** Скрыть ВСЕ сообщения донора на канале (одной кнопкой). Только менеджер; деньги/standing не трогаются. */
  async hideDonorMessages(channelId: string, donor: Address): Result<{ hidden: number }> {
    await this.gate("hideDonorMessages");
    this.requireChannelManager(channelId);
    let hidden = 0;
    for (const d of this.donations) {
      if (d.channelId !== channelId || d.donor !== donor || !d.message) continue;
      if (d.message.state === "HIDDEN") continue;
      const updated: MessageRef = { ...d.message, state: "HIDDEN" };
      this.messages.set(updated.id, updated);
      d.message = updated;
      hidden++;
    }
    return { hidden };
  }

  /**
   * Жалоба зрителя на ПОКАЗАННЫЙ текст. Любой вошедший, одна жалоба на сообщение с адреса (анти-накрутка).
   * Первая жалоба → инцидент стримеру/оператору; при пороге уникальных жалоб текст авто-скрывается (HIDDEN)
   * до решения человека. Деньги/репутация не трогаются (§4.7). Жаловаться можно только на показанное (§4.6).
   */
  async reportMessage(
    messageId: string,
    reason?: string,
  ): Result<{ reports: number; hidden: boolean }> {
    await this.gate("reportMessage");
    const reporter = this.requireSession();
    const msg = this.messages.get(messageId);
    if (!msg) throw new DataError("NO_MESSAGE", "Сообщение не найдено.");
    // Показанное может репортить любой вошедший; НЕ показанное (HELD/карантин) — только менеджер канала
    // (эскалация в T&S из очереди модерации).
    if (msg.state !== "SHOWN" && !this.isChannelManager(msg.channelId)) {
      throw new DataError(
        "NOT_REPORTABLE",
        "Жаловаться можно на показанный текст или из очереди модерации.",
      );
    }
    if (this.reports.some((r) => r.messageId === messageId && r.reporter === reporter)) {
      throw new DataError("ALREADY_REPORTED", "Ты уже пожаловался на это сообщение.");
    }
    reason = reason?.slice(0, REASON_MAX); // ограничиваем длину причины (свободный текст)
    const ts = this.now();
    const author = this.donations.find((d) => d.id === msg.donationId)?.donor; // автор контента
    this.reports.push({ messageId, channelId: msg.channelId, reporter, reason, ts });
    const count = this.reports.filter((r) => r.messageId === messageId).length;

    if (count === 1) {
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: msg.channelId,
        address: author,
        kind: "report",
        detail: `Жалоба${reason ? `: ${reason}` : ""}.`,
        text: msg.text,
        ts,
      });
    }

    let hidden = false;
    if (count >= REPORT_HIDE_THRESHOLD && msg.state === "SHOWN") {
      const updated: MessageRef = { ...msg, state: "HIDDEN" };
      this.messages.set(messageId, updated);
      const donation = this.donations.find((d) => d.id === msg.donationId);
      if (donation) donation.message = updated;
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: msg.channelId,
        address: author,
        kind: "report",
        detail: `Авто-скрыто: ${count} жалоб(ы). Стример/оператор может пересмотреть.`,
        text: msg.text,
        ts,
      });
      hidden = true;
    }
    return { reports: count, hidden };
  }

  // — Канальный блок-лист —
  async getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    await this.gate("getChannelBlocklist");
    this.requireChannelManager(channelId);
    return this.blocks.filter((b) => b.channelId === channelId);
  }
  /** Донор: МОЙ блок на этом канале (+причина) — для плашки в карточке доната. Видит только свой блок. */
  async getMyChannelBlock(channelId: string): Result<ChannelBlock | null> {
    await this.gate("getMyChannelBlock");
    const donor = this.session().address;
    if (!donor) return null;
    return this.blocks.find((b) => b.channelId === channelId && b.blockedAddress === donor) ?? null;
  }
  async addChannelBlock(
    channelId: string,
    address: Address,
    reason?: string,
  ): Result<ChannelBlock> {
    await this.gate("addChannelBlock");
    // R9 (ADR 0012): право и автор — явными вызовами, не через && (было хрупко: значение от side-effect).
    this.requireChannelManager(channelId, true); // право: владелец или модератор со скоупом бана
    const byModerator = this.requireSession(); // адрес, записываемый как автор бана
    const block: ChannelBlock = {
      channelId,
      blockedAddress: address,
      reason: reason?.slice(0, REASON_MAX), // ограничиваем длину причины
      byModerator,
      ts: this.now(),
    };
    this.blocks.push(block);
    return block;
  }
  async removeChannelBlock(channelId: string, address: Address): Result<void> {
    await this.gate("removeChannelBlock");
    this.requireChannelManager(channelId, true);
    this.blocks = this.blocks.filter(
      (b) => !(b.channelId === channelId && b.blockedAddress === address),
    );
  }

  // — Оператор / T&S —
  async getOperatorQueue(): Result<IncidentLog[]> {
    await this.gate("getOperatorQueue");
    this.requireOperator();
    return [...this.incidents].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }
  async applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    await this.gate("applyOperatorAction");
    const operator = this.requireOperator(); // только оператор: бан/заморозка каналов, тейкдаун (§4.5)
    // Санкция без нужной цели — не «тихий лог», а явная ошибка (иначе кнопка «сработала», но ничего не сделала).
    const need = (ok: boolean, msg: string) => {
      if (!ok) throw new DataError("BAD_TARGET", msg);
    };
    switch (action.action) {
      case "HIDE_MESSAGE":
        need(!!action.targetContentId, "Укажи id задания или сообщения для снятия с публикации.");
        break;
      case "BAN_WALLET_FULL":
        need(!!action.targetAddress, "Укажи адрес кошелька для полного бана.");
        break;
      case "CHANNEL_BLOCK":
        need(!!action.targetChannelId && !!action.targetAddress, "Нужны канал и адрес кошелька.");
        break;
      case "SUSPEND_CHANNEL":
      case "BAN_CREATOR_ROLE":
        need(!!action.targetChannelId, "Укажи канал.");
        break;
      case "REINSTATE_CHANNEL": // восстановление — снимает санкцию с любой цели: канал / кошелёк / контент
        need(
          !!action.targetChannelId || !!action.targetAddress || !!action.targetContentId,
          "Укажи цель восстановления (канал, кошелёк или id контента).",
        );
        break;
    }
    const full: OperatorAction = {
      ...action,
      reason: (action.reason ?? "").slice(0, REASON_MAX), // ограничиваем длину причины
      id: this.nextId("op"),
      ts: this.now(),
      byOperator: operator,
    };
    this.operatorActions.push(full);
    // Оператор репутацию НЕ редактирует (CR-1): наказание — БЛОК (бан кошелька/канальный блок), который
    // обесценивает репутацию, не трогая честное перевычислимое число (§4.4/§4.5). Единственное списание
    // очков — протокольный DISPUTE_LOST (проигранный ложный спор), не операторская кнопка.
    if (
      (action.action === "SUSPEND_CHANNEL" || action.action === "BAN_CREATOR_ROLE") &&
      action.targetChannelId
    ) {
      const ch = this.channelsById.get(action.targetChannelId);
      if (ch) {
        const status = action.action === "SUSPEND_CHANNEL" ? "SUSPENDED" : "BANNED";
        this.channelsById.set(ch.id, { ...ch, status });
      }
    }
    // Тейкдаун контента: снять задание/сообщение с публикации НАСОВСЕМ (перебивает стримера и авто-раскрытие
    // индексера — см. isContentBlocked/revealFromChain). Множество вычислит rebuild ниже из журнала. Для
    // донат-сообщения дополнительно гасим его state — уходит из очереди/ленты сразу (для заданий видимость
    // целиком даёт override-набор). Деньги ончейн не трогаем (§4.1/§4.2).
    if (action.action === "HIDE_MESSAGE" && action.targetContentId) {
      const msg = this.messages.get(action.targetContentId);
      if (msg) this.messages.set(msg.id, { ...msg, state: "HIDDEN" });
    }
    // Канальный блок кошелька: переиспользуем блок-лист канала (this.blocks) — он уже гейтит донат-с-текстом
    // (precheckText/createDonation) и прячет ник. Идемпотентно (не плодим дубли).
    if (action.action === "CHANNEL_BLOCK" && action.targetChannelId && action.targetAddress) {
      const exists = this.blocks.some(
        (b) => b.channelId === action.targetChannelId && b.blockedAddress === action.targetAddress,
      );
      if (!exists)
        this.blocks.push({
          channelId: action.targetChannelId,
          blockedAddress: action.targetAddress,
          reason: full.reason || undefined,
          byModerator: operator,
          ts: this.now(),
        });
    }
    // Восстановление: обратное к любой санкции по указанной цели. Канал: SUSPENDED|BANNED → ACTIVE (BASIC не
    // трогаем — иначе обошли бы платный сбор активации). Кошелёк/контент снимутся в rebuild ниже; канальный
    // блок (канал+адрес) убираем из блок-листа тут.
    if (action.action === "REINSTATE_CHANNEL") {
      if (action.targetChannelId) {
        const ch = this.channelsById.get(action.targetChannelId);
        if (ch && (ch.status === "SUSPENDED" || ch.status === "BANNED"))
          this.channelsById.set(ch.id, { ...ch, status: "ACTIVE" });
        if (action.targetAddress)
          this.blocks = this.blocks.filter(
            (b) =>
              !(b.channelId === action.targetChannelId && b.blockedAddress === action.targetAddress),
          );
      }
    }
    this.rebuildOperatorOverrides(); // тейкдаун контента / бан кошелька — из журнала (последнее действие побеждает)
    // Карательный инцидент — только для санкций; восстановление это резолюция, не инцидент (есть в журнале
    // operatorActions). Иначе бейдж «Флуд» вводил бы в заблуждение.
    if (action.action !== "REINSTATE_CHANNEL") {
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: action.targetChannelId,
        address: action.targetAddress,
        kind: full.reason.includes("CSAM") ? "hard_block" : "flood",
        detail: `Действие оператора: ${action.action} (${full.reason})`,
        resolution: action.preservation ? "preservation + репорт" : undefined,
        ts: this.now(),
      });
    }
    return full;
  }

  // — Мини-игры (game-bus, ADR 0016) —
  async gameAction(req: GameRequest): Result<unknown> {
    return this.dispatchGameOp("action", req);
  }
  async gameQuery(req: GameRequest): Result<unknown> {
    return this.dispatchGameOp("query", req);
  }
  // — Публичный экспорт (перевычислимость §4.4; НЕ в RPC-вайтлисте — отдаётся GET-роутами /api/v1/export) —

  /**
   * Экспорт одного канала для независимого пересчёта: канал (с payout-аттестацией) + все версии конфига +
   * журнал репутации + текущий лидерборд как сверяемая цифра. Только публичные данные: журнал не содержит
   * текстов (§4.6), конфиг и лидерборд и так читаются публичными методами.
   */
  exportChannelData(handle: string): {
    channel: Channel;
    configs: ChannelConfig[];
    ledger: LedgerEvent[];
    leaderboard: LeaderboardEntry[];
  } | null {
    const id = this.handleToId.get(handle.trim().toLowerCase());
    const channel = id ? this.channelsById.get(id) : undefined;
    if (!id || !channel) return null;
    return {
      channel,
      configs: this.configsByChannel.get(id) ?? [],
      ledger: this.ledger.filter((e) => e.creator === id),
      leaderboard: this.computeLeaderboard(id, "all_time"),
    };
  }

  /**
   * Срезы состояния под пруф-якорь (server/anchor.ts): полный журнал + все версии конфигов (публичные) и
   * операторский лог (инцидент-лог + действия оператора — содержат приватный текст, наружу уходят ТОЛЬКО их
   * хэши; решения канальных модераторов стримера — не операторский слой и не якорятся). Дайджесты этих срезов периодически публикуются ончейн-якорем — тихо переписать прошлое нельзя.
   */
  exportAnchorData(): {
    ledger: LedgerEvent[];
    configs: ChannelConfig[];
    incidents: IncidentLog[];
    operatorActions: OperatorAction[];
  } {
    return {
      ledger: this.ledger,
      configs: [...this.configsByChannel.values()].flat(),
      incidents: this.incidents,
      operatorActions: this.operatorActions,
    };
  }

  // Серверные хуки сверки эскроу (chain). Инжектятся из store.ts (сервер), чтобы серверный граф
  // (`@/server/escrow-verify` → store-db → PGlite/node:path) не попадал в клиентский бандл. В браузере/mock
  // не заданы → verifyEscrow=true, escrowOutcome отсутствует (эскроу нет).
  verifyEscrowHook?: (
    escrowTaskId: string,
    expect: { donor: string; amount: string; streamer?: string },
  ) => Promise<boolean>;
  escrowOutcomeHook?: (escrowTaskId: string) => Promise<"to_streamer" | "to_donor" | null>;
  escrowStateHook?: (escrowTaskId: string) => Promise<number | null>; // ESC-19: сырое ончейн-состояние

  // Очереди сериализации операций над общим in-memory стором: мутации игры по gameId (ESC-15; слайс игры
  // один на ВСЕ каналы) и приём доната по подписи (B1). Закрывают гонки «прочитал → await → записал»
  // (двойная банковка, потеря обновлений) — один писатель на ключ за раз. Рост ограничен числом ключей.
  private gameActionTails = new Map<string, Promise<void>>();
  private ingestTails = new Map<string, Promise<void>>();
  /** Сериализует операцию по ключу в указанной очереди: следующая ждёт предыдущую. */
  private runSerialized<T>(
    tails: Map<string, Promise<void>>,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    tails.set(
      key,
      prev.then(() => gate),
    );
    return prev.catch(() => undefined).then(async () => {
      try {
        return await run();
      } finally {
        release();
      }
    });
  }
  private serializeGameAction<T>(gameId: string, run: () => Promise<T>): Promise<T> {
    return this.runSerialized(this.gameActionTails, gameId, run);
  }

  /**
   * Общий диспатч операций мини-игр: канал должен существовать и игра — быть включена на нём (cold-start).
   * Дальше маршрутизируем в обработчик игры через шину, дав ему узкий контекст (личность, канал, now, свой
   * слайс состояния). Ошибки шины мапим в DataError → доходят до клиента понятным кодом.
   */
  private async dispatchGameOp(kind: "action" | "query", req: GameRequest): Promise<unknown> {
    await this.gate(kind === "action" ? "gameAction" : "gameQuery");
    const cfg = this.latestConfig(req.channelId); // бросит NO_CONFIG, если канала нет
    // Выключение игры не стирает историю и не ломает существующие партии: ЧТЕНИЕ (query) и действия по уже
    // созданным заданиям (принять/забрать/скрыть/сеттл — деньги должны довинтиться, история остаётся в ленте)
    // разрешены всегда. Блокируем только СОЗДАНИЕ новой партии (create) на выключенной игре.
    if (kind === "action" && req.op === "create" && !cfg.enabledGames.includes(req.gameId)) {
      throw new DataError("GAME_NOT_ENABLED", "Эта мини-игра не включена на канале.");
    }
    // Забаненный оператором кошелёк не играет (создать/принять/голосовать и т.п.). Фоновый сеттлер зовёт
    // без личности (settleDue) → requireNotBanned(null) — no-op, индексер не трогаем.
    if (kind === "action") this.requireNotBanned(this.currentAddress());
    const exec = async (): Promise<unknown> => {
      const ctx: GameContext = {
        identity: this.currentAddress(),
        channelId: req.channelId,
        channelOwner: this.channelsById.get(req.channelId)?.ownerAddress ?? null,
        channelPayout: this.channelsById.get(req.channelId)?.payoutAddress ?? null,
        isChannelManager: this.isChannelManager(req.channelId),
        // Рычаги канала для create (спека §10): задание = донат с текстом → бóльший из двух минимумов.
        minTaskAmountMicro: (cfg.minDonationWithText > cfg.minDonation
          ? cfg.minDonationWithText
          : cfg.minDonation
        ).toString(),
        // §10: пороги репутации на присыл задания / на право поднять спор (рычаги стримера, антиспам).
        minReputationToTask: cfg.minReputationToTask,
        minReputationToDispute: cfg.minReputationToDispute,
        textMaxLen: cfg.messageMaxLen,
        now: () => this.now(),
        newId: () => this.nextId("game"),
        state: {
          get: <T = unknown>() => this.gameState.get(req.gameId) as T | undefined,
          set: (value: unknown) => this.gameState.set(req.gameId, value),
        },
        // Мостики в ядро (ADR 0015): вес = очки на момент; банковка эффектов игры в журнал канала;
        // модерация UGC игры тем же ядровым пайплайном (для заданий — строгая политика, classifyTaskText).
        // Вес голоса/кворум = очки на снэпшоте. Оператор репутацию не редактирует (нет ADMIN_VOID, CR-1) →
        // вес честный; единственное списание — протокольный DISPUTE_LOST (проигранный ложный спор).
        reputationAsOf: (address, asOf) =>
          computePointsAsOf(this.eventsFor(address, req.channelId), asOf),
        moderate: (text) => classifyTaskText(text),
        textShowMode: cfg.textShowMode, // та же политика публикации, что у донат-сообщений (очередь/авто)
        // Серверные хуки сверки эскроу (ADR 0017/ESC-12) ИНЖЕКТЯТСЯ из store.ts (сервер) — так серверный DB/
        // web3.js-граф (`@/server/escrow-verify` → store-db → PGlite/node:path) НЕ попадает в клиентский бандл
        // mock-провайдера. В браузере/mock хуки не заданы → verifyEscrow=true, escrowOutcome отсутствует (эскроу нет).
        verifyEscrow: this.verifyEscrowHook ?? (async () => true),
        // CR-4: чистая крипто-сверка коммитмента (не зависит от режима/сервера) — task_id == SHA-256(nonce ‖ text).
        verifyTextCommitment: async (escrowTaskId, text, nonce) =>
          !!nonce && (await taskTextCommitment(text, nonce)) === escrowTaskId,
        escrowOutcome: this.escrowOutcomeHook,
        escrowState: this.escrowStateHook,
        isContentBlocked: (id) => this.operatorBlockedContent.has(id), // операторский тейкдаун (модерация)
        bankLedger: (entries) => {
          for (const e of entries) {
            this.ledger.push({
              id: this.nextId("gl"),
              donor: e.address,
              creator: req.channelId,
              type: e.type as LedgerEvent["type"],
              amount: BigInt(e.amount ?? "0"),
              pointsDelta: e.pointsDelta,
              configVersion: cfg.version,
              ts: this.now(),
            });
          }
        },
      };
      try {
        return await dispatchGame(GAME_HANDLERS, req.gameId, kind, req.op, ctx, req.payload);
      } catch (e) {
        if (e instanceof GameBusError) throw new DataError(e.code, e.message);
        throw e;
      }
    };
    // ESC-15: мутации игры сериализуем по gameId (слайс общий на все каналы — лок по каналу не спас бы от
    // межканальной гонки/потери обновлений); чтения не мутируют — без очереди.
    return kind === "action" ? this.serializeGameAction(req.gameId, exec) : exec();
  }
}
