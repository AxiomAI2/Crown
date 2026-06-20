import { OPERATOR_ADDRESS } from "../chain/addresses";
import { computePoints, pointsForAmount, resolveTier } from "../reputation";
import { isLikelyBase58Address, toMicro } from "../utils";
import { defaultChannelConfig } from "./fixtures";
import { runPipeline } from "./moderation";
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
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LedgerEvent,
  LightProfile,
  ListOpts,
  MessageRef,
  ModerationVerdict,
  OperatorAction,
  OverlayEvent,
  Page,
  Session,
  ViewerStanding,
} from "./types";

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
  "getIncidentLog",
]);

/**
 * In-memory backend-store. Личность — РЕАЛЬНЫЙ адрес кошелька (Фаза 3): нет фикстур и dev-личностей,
 * каналы создают пользователи, ончейн-донаты принимаются через recordDonationFromChain (после валидации
 * сервером из цепочки). Репутация считается общим движком lib/reputation.ts. Persistence — in-memory
 * (стенд-ин под Postgres; сбрасывается при перезапуске процесса).
 *
 * `createDonation` (оффчейн-симуляция) оставлен для api/mock без кошелька; в режиме chain деньги идут
 * ончейн, а зачёт делает ingest по подписи.
 */
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
  private overlaySubs = new Map<string, Set<(e: OverlayEvent) => void>>();

  private sessionAddress: Address | null = null;
  private failMode = process.env.NEXT_PUBLIC_MOCK_FAIL === "on";
  private latencyScale = 1;
  private seq = 0;
  private modCache = new Map<string, ModerationVerdict>();

  // — Инфраструктура —
  private now(): string {
    return new Date().toISOString();
  }
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.now()}-${this.seq}`;
  }
  private async gate(method: string): Promise<void> {
    let h = 0;
    for (const ch of method) h = (h * 31 + ch.charCodeAt(0)) % 997;
    const ms = (120 + (h / 997) * 380) * this.latencyScale;
    // На сервере (latencyScale=0) НЕ уступаем macrotask — иначе конкурентные RPC перетрут sessionAddress.
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
  private session(): Session {
    const address = this.sessionAddress;
    if (!address) return { address: null, level: "address_only", isCreator: false, isOperator: false };
    const isCreator = [...this.channelsById.values()].some((c) => c.ownerAddress === address);
    return { address, level: "address_only", isCreator, isOperator: address === OPERATOR_ADDRESS };
  }

  // — Авторизация. Личность = ПРОВЕРЕННЫЙ адрес сессии (выставлен из токена SIWS, см. server/auth.ts).
  // До этих проверок любой мог слать `address` в теле и выдавать себя за оператора/владельца (дыра C1/C3).
  private requireSession(): Address {
    const addr = this.sessionAddress;
    if (!addr) throw new DataError("NO_SESSION", "Сначала подключи кошелёк и войди (подпись).");
    return addr;
  }
  private requireOperator(): Address {
    const addr = this.requireSession();
    if (addr !== OPERATOR_ADDRESS) {
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
    const addr = this.sessionAddress;
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
    if (!m || isManager || m.state === "SHOWN") return d;
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
    return { channelId, donor, points, tier, nextTier, progressToNext, totalDonated, firstDonationAt };
  }
  private emitOverlay(channelId: string, event: OverlayEvent) {
    this.overlaySubs.get(channelId)?.forEach((cb) => cb(event));
  }

  // — Dev/инжект адреса (вне интерфейса) —
  __setAddress(address: Address | null) {
    this.sessionAddress = address;
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
    this.overlaySubs.clear();
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
    const updated: LightProfile = { ...(this.profiles.get(addr) ?? { address: addr }), ...patch, address: addr };
    this.profiles.set(addr, updated);
    return updated;
  }

  // — Дискавери / каналы —
  async listChannels(_opts?: ListOpts): Result<Page<ChannelCard>> {
    await this.gate("listChannels");
    const items: ChannelCard[] = [...this.channelsById.values()]
      .filter((c) => c.status === "ACTIVE")
      .map((c) => {
        const board = this.computeLeaderboard(c.id, "all_time");
        const top = board[0];
        const profile = top ? this.profiles.get(top.donor) : undefined;
        return {
          channelId: c.id,
          handle: c.handle,
          displayName: profile?.displayName,
          topTierName: top ? top.tier.name : this.latestConfig(c.id).tiers[0]?.name ?? "Новичок",
          donorsCount: board.length,
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
    // Валидация входов на денежном пути: кривой payout уронил бы сборку tx; handle нормализуем и
    // проверяем по строгому шаблону, уникальность — БЕЗ учёта регистра (анти-имперсонация @Foo/@foo).
    const handle = (input.handle ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
      throw new DataError("BAD_HANDLE", "Handle: 3–32 символа [a-z0-9_].");
    }
    if (!isLikelyBase58Address(input.payoutAddress)) {
      throw new DataError("BAD_PAYOUT", "payoutAddress не похож на Solana-адрес.");
    }
    if ([...this.channelsById.values()].some((c) => c.ownerAddress === addr)) throw ErrChannelAlreadyExists;
    if (this.handleToId.has(handle)) {
      throw new DataError("HANDLE_TAKEN", `Handle @${handle} уже занят.`);
    }
    const id = this.nextId("ch");
    const channel: Channel = {
      id,
      ownerAddress: addr,
      payoutAddress: input.payoutAddress,
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
  async updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    await this.gate("updateChannelConfig");
    this.requireChannelOwner(channelId);
    const list = this.configsByChannel.get(channelId);
    const current = list?.[list.length - 1];
    if (!list || !current) throw new DataError("NO_CONFIG", "Нет конфига канала.");
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
  private computeLeaderboard(channelId: string, period: LeaderboardPeriod): LeaderboardEntry[] {
    if (!this.configsByChannel.has(channelId)) return [];
    const cfg = this.latestConfig(channelId);
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
      const totalDonated = events.filter((e) => e.type === "DONATION").reduce((s, e) => s + e.amount, 0n);
      entries.push({
        rank: 0,
        donor,
        displayName: this.profiles.get(donor)?.displayName,
        points,
        tier: resolveTier(points, cfg.tiers).tier,
        totalDonated,
      });
    }
    entries.sort((a, b) => b.points - a.points);
    entries.forEach((e, i) => (e.rank = i + 1));
    return period === "top_donor_month" ? entries.slice(0, 1) : entries.slice(0, 50);
  }

  // — Донаты —
  /** Оффчейн-симуляция (api/mock без кошелька). В режиме chain не используется. */
  async createDonation(input: DonationInput): Result<DonationResult> {
    await this.gate("createDonation");
    const donor = this.session().address;
    if (!donor) throw new DataError("NO_SESSION", "Сначала подключи кошелёк, чтобы задонатить.");
    const ch = this.channelsById.get(input.channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Канал не найден.");
    const cfg = this.latestConfig(input.channelId);
    const hasText = Boolean(input.text && input.text.trim());
    const amount = toMicro(input.amountUSDC);
    const min = hasText ? cfg.minDonationWithText : cfg.minDonation;
    if (amount < min) throw new DataError("BELOW_MIN", "Сумма ниже минимума канала.");
    if (hasText && ch.status !== "ACTIVE") throw ErrTextRequiresActiveChannel;
    if (hasText && this.blocks.some((b) => b.channelId === input.channelId && b.blockedAddress === donor)) {
      throw new DataError("BLOCKED", "Этот кошелёк заблокирован на канале для донатов-с-текстом.");
    }
    const fee = (amount * 3n) / 100n;
    const net = amount - fee;
    const result = this.record({
      channelId: input.channelId,
      donor,
      amount,
      fee,
      net,
      text: hasText ? input.text!.trim() : undefined,
      textShowMode: cfg.textShowMode,
    });
    return result;
  }

  /** Запись ончейн-доната (после валидации сервером из цепочки). Идемпотентно по signature. */
  recordDonationFromChain(params: {
    signature: string;
    donor: Address;
    channelId: string;
    amountMicro: bigint;
    feeMicro: bigint;
    netMicro: bigint;
  }): DonationResult | null {
    if (this.ledger.some((e) => e.txSignature === params.signature)) return null; // уже принято
    const ch = this.channelsById.get(params.channelId);
    if (!ch) return null;
    return this.record({
      channelId: params.channelId,
      donor: params.donor,
      amount: params.amountMicro,
      fee: params.feeMicro,
      net: params.netMicro,
      signature: params.signature,
    });
  }

  /** Общая запись доната: банкинг очков СРАЗУ, текст → HELD/модерация (инварианты §4). */
  private record(p: {
    channelId: string;
    donor: Address;
    amount: bigint;
    fee: bigint;
    net: bigint;
    text?: string;
    textShowMode?: ChannelConfig["textShowMode"];
    signature?: string;
  }): DonationResult {
    const cfg = this.latestConfig(p.channelId);
    const pointsDelta = pointsForAmount(p.amount); // фиксировано: 1 USDC = 100 очков
    const ts = this.now();
    const tierBefore = this.standingFor(p.channelId, p.donor)?.tier.name;
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
    if (p.text) {
      const { verdict, lang, contentHash, deduped } = runPipeline(p.text, this.modCache, { scope: p.channelId });
      const isHardBlock = verdict === "HARD_BLOCK";
      const autoShow = !isHardBlock && p.textShowMode === "auto_if_clean" && verdict === "CLEAR";
      const messageId = this.nextId("m");
      const message: MessageRef = {
        id: messageId,
        donationId,
        channelId: p.channelId,
        text: p.text,
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
          channelId: p.channelId,
          kind: "hard_block",
          detail: "Авто-карантин: hard-block в тексте доната.",
          ts,
        });
      }
    }
    this.donations.push(donation);
    const standing = this.standingFor(p.channelId, p.donor)!;
    const tierChanged = tierBefore !== undefined && tierBefore !== standing.tier.name;
    if (donation.message?.state === "SHOWN") {
      this.emitOverlay(p.channelId, { kind: "donation_shown", donation, standing });
    }
    if (tierChanged) this.emitOverlay(p.channelId, { kind: "tier_up", donor: p.donor, tier: standing.tier });
    return { donation, standing, tierChanged };
  }

  async listDonations(channelId: string, _opts?: ListOpts): Result<Page<Donation>> {
    await this.gate("listDonations");
    const isManager = this.isChannelManager(channelId);
    const items = this.donations
      .filter((d) => d.channelId === channelId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((d) => this.redactDonation(d, isManager));
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
    const updated: MessageRef = { ...msg, state, shownAt: state === "SHOWN" ? this.now() : msg.shownAt };
    this.messages.set(messageId, updated);
    const donation = this.donations.find((d) => d.id === msg.donationId);
    if (donation) donation.message = updated;
    if (state === "SHOWN" && donation) {
      const standing = this.standingFor(msg.channelId, donation.donor);
      if (standing) this.emitOverlay(msg.channelId, { kind: "donation_shown", donation, standing });
    }
    return updated;
  }

  // — Канальный блок-лист —
  async getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    await this.gate("getChannelBlocklist");
    this.requireChannelManager(channelId);
    return this.blocks.filter((b) => b.channelId === channelId);
  }
  async addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock> {
    await this.gate("addChannelBlock");
    const byModerator = this.requireChannelManager(channelId, true) && this.requireSession();
    const block: ChannelBlock = {
      channelId,
      blockedAddress: address,
      reason,
      byModerator,
      ts: this.now(),
    };
    this.blocks.push(block);
    return block;
  }
  async removeChannelBlock(channelId: string, address: Address): Result<void> {
    await this.gate("removeChannelBlock");
    this.requireChannelManager(channelId, true);
    this.blocks = this.blocks.filter((b) => !(b.channelId === channelId && b.blockedAddress === address));
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
    const operator = this.requireOperator(); // только оператор: бан/заморозка каналов, ADMIN_VOID (§4.5)
    const full: OperatorAction = {
      ...action,
      id: this.nextId("op"),
      ts: this.now(),
      byOperator: operator,
    };
    this.operatorActions.push(full);
    if (action.action === "ADMIN_VOID" && action.targetAddress && action.targetChannelId) {
      const events = this.eventsFor(action.targetAddress, action.targetChannelId);
      const cfg = this.latestConfig(action.targetChannelId);
      const points = computePoints(events);
      this.ledger.push({
        id: this.nextId("l"),
        donor: action.targetAddress,
        creator: action.targetChannelId,
        type: "ADMIN_VOID",
        amount: 0n,
        pointsDelta: -points,
        configVersion: cfg.version,
        ts: this.now(),
      });
    }
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
    this.incidents.push({
      id: this.nextId("inc"),
      channelId: action.targetChannelId,
      address: action.targetAddress,
      kind: action.reason.includes("CSAM") ? "hard_block" : "flood",
      detail: `Действие оператора: ${action.action} (${action.reason})`,
      resolution: action.preservation ? "preservation + репорт" : undefined,
      ts: this.now(),
    });
    return full;
  }
  async getIncidentLog(_opts?: ListOpts): Result<Page<IncidentLog>> {
    await this.gate("getIncidentLog");
    this.requireOperator();
    const items = [...this.incidents].sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return { items };
  }

  // — Оверлей —
  subscribeOverlay(channelId: string, cb: (e: OverlayEvent) => void): () => void {
    const set = this.overlaySubs.get(channelId) ?? new Set();
    set.add(cb);
    this.overlaySubs.set(channelId, set);
    return () => {
      set.delete(cb);
    };
  }
}
