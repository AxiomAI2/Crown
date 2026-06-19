import { bankPoints, computePoints, resolveTier } from "../reputation";
import { toMicro } from "../utils";
import {
  DataError,
  ErrChannelAlreadyExists,
  ErrTextRequiresActiveChannel,
  type DataProvider,
  type Result,
} from "./provider";
import {
  buildSeed,
  DEFAULT_TIERS,
  DEV_SESSIONS,
  type IdentityKey,
} from "./fixtures";
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

// — Мок-модерация (упрощённый конвейер core-spec.md §8) —
const MOCK_HARD_LIST = ["csam", "hardblock", "убейс"];
const MOCK_FLAG_LIST = ["худший", "лох", "idiot", "scam"];

function detectLang(text: string): string {
  if (/[¡¿]|gracias|directo/i.test(text)) return "es";
  if (/[а-яё]/i.test(text)) return "ru";
  return "en";
}

function mockModerate(text: string): { verdict: ModerationVerdict; lang: string } {
  const lower = text.toLowerCase();
  const lang = detectLang(text);
  if (MOCK_HARD_LIST.some((w) => lower.includes(w))) return { verdict: "HARD_BLOCK", lang };
  if (MOCK_FLAG_LIST.some((w) => lower.includes(w))) return { verdict: "FLAG", lang };
  return { verdict: "CLEAR", lang };
}

const FAILABLE = new Set([
  "listChannels",
  "getChannel",
  "getStanding",
  "getLeaderboard",
  "listDonations",
  "getModerationQueue",
  "getChannelBlocklist",
  "getOperatorQueue",
  "getIncidentLog",
]);

/**
 * Фаза 1: полноценный детерминированный симулятор (frontend/mock-data.md §3).
 * In-memory store из фикстур, латентность, инъекция ошибок, симуляция переходов с соблюдением
 * инвариантов CLAUDE.md §4 (деньги/репутация сразу и независимо от текста, банкинг, only-grows).
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

  private sessionKey: IdentityKey = "guest";
  private failMode = process.env.NEXT_PUBLIC_MOCK_FAIL === "on";
  private latencyScale = 1;
  private seq = 0;

  constructor() {
    this.loadSeed();
  }

  private loadSeed() {
    const seed = buildSeed();
    this.channelsById = new Map(seed.channels.map((c) => [c.id, c]));
    this.handleToId = new Map(seed.channels.map((c) => [c.handle, c.id]));
    this.configsByChannel = new Map();
    for (const cfg of seed.configs) {
      const list = this.configsByChannel.get(cfg.channelId) ?? [];
      list.push(cfg);
      this.configsByChannel.set(cfg.channelId, list);
    }
    this.profiles = new Map(seed.profiles.map((p) => [p.address, p]));
    this.ledger = [...seed.ledger];
    this.donations = [...seed.donations];
    this.messages = new Map(seed.messages.map((m) => [m.id, m]));
    this.blocks = [...seed.blocks];
    this.incidents = [...seed.incidents];
    this.operatorActions = [];
  }

  // — Инфраструктура —
  private now(): string {
    return new Date().toISOString();
  }
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-s${this.seq}`;
  }
  private async gate(method: string): Promise<void> {
    let h = 0;
    for (const ch of method) h = (h * 31 + ch.charCodeAt(0)) % 997;
    const ms = (120 + (h / 997) * 380) * this.latencyScale;
    await new Promise((r) => setTimeout(r, ms));
    if (this.failMode && FAILABLE.has(method)) {
      throw new DataError("MOCK_FAIL", `Мок-сбой (${method}) — для проверки error-стейтов.`);
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
    const base = DEV_SESSIONS[this.sessionKey];
    if (!base.address) return base;
    const isCreator = [...this.channelsById.values()].some(
      (c) => c.ownerAddress === base.address,
    );
    return { ...base, isCreator };
  }

  private standingFor(channelId: string, donor: Address): ViewerStanding | null {
    const events = this.eventsFor(donor, channelId);
    if (events.length === 0) return null;
    const cfg = this.latestConfig(channelId);
    const points = computePoints(events, cfg.reputation, this.now());
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

  // — Dev-контролы (вне интерфейса; зовутся из /dev/kitchen-sink через каст) —
  __setIdentity(key: IdentityKey) {
    this.sessionKey = key;
  }
  __getIdentityKey(): IdentityKey {
    return this.sessionKey;
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
    this.sessionKey = "guest";
    this.failMode = false;
    this.latencyScale = 1;
    this.seq = 0;
    this.overlaySubs.clear();
    this.loadSeed();
  }

  // — Сессия / идентичность —
  async getSession(): Result<Session> {
    await this.gate("getSession");
    return this.session();
  }
  async connect(): Result<Session> {
    await this.gate("connect");
    if (this.sessionKey === "guest") this.sessionKey = "donorA";
    return this.session();
  }
  async disconnect(): Result<void> {
    await this.gate("disconnect");
    this.sessionKey = "guest";
  }
  async getProfile(address: Address): Result<LightProfile | null> {
    await this.gate("getProfile");
    return this.profiles.get(address) ?? null;
  }
  async updateProfile(patch: Partial<LightProfile>): Result<LightProfile> {
    await this.gate("updateProfile");
    const addr = this.session().address;
    if (!addr) throw new DataError("NO_SESSION", "Сначала подключи кошелёк.");
    const existing = this.profiles.get(addr) ?? { address: addr };
    const updated: LightProfile = { ...existing, ...patch, address: addr };
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
    const id = this.handleToId.get(handle);
    return id ? (this.channelsById.get(id) ?? null) : null;
  }
  async getMyChannel(): Result<Channel | null> {
    await this.gate("getMyChannel");
    const addr = this.session().address;
    if (!addr) return null;
    return [...this.channelsById.values()].find((c) => c.ownerAddress === addr) ?? null;
  }
  async getChannelConfig(channelId: string): Result<ChannelConfig> {
    await this.gate("getChannelConfig");
    return this.latestConfig(channelId);
  }
  async createChannel(input: CreateChannelInput): Result<Channel> {
    await this.gate("createChannel");
    const addr = this.session().address;
    if (!addr) throw new DataError("NO_SESSION", "Сначала подключи кошелёк.");
    const owns = [...this.channelsById.values()].some((c) => c.ownerAddress === addr);
    if (owns) throw ErrChannelAlreadyExists;
    if (this.handleToId.has(input.handle)) {
      throw new DataError("HANDLE_TAKEN", `Handle @${input.handle} уже занят.`);
    }
    const id = this.nextId("ch");
    const channel: Channel = {
      id,
      ownerAddress: addr,
      payoutAddress: input.payoutAddress,
      handle: input.handle,
      status: "BASIC",
      configVersion: 1,
      createdAt: this.now(),
    };
    this.channelsById.set(id, channel);
    this.handleToId.set(input.handle, id);
    this.configsByChannel.set(id, [
      {
        channelId: id,
        version: 1,
        hash: `cfg-${id}-v1`,
        reputation: { curve: { kind: "linear", pointsPerUSDC: 100 }, multipliers: [], decay: { enabled: false } },
        tiers: DEFAULT_TIERS,
        minDonation: toMicro(1),
        minDonationWithText: toMicro(2),
        messageMaxLen: 200,
        profanityPolicy: "queue",
        nameMode: "addresses_only",
        textShowMode: "manual",
        overlay: { style: "default", sound: false, minAmountToShow: toMicro(1), tts: false },
        moderators: [],
        updatedAt: this.now(),
      },
    ]);
    return channel;
  }
  async activateChannel(channelId: string): Result<Channel> {
    await this.gate("activateChannel");
    const ch = this.channelsById.get(channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Канал не найден.");
    const updated: Channel = { ...ch, status: "ACTIVE", activatedAt: this.now() };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  async updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    await this.gate("updateChannelConfig");
    const list = this.configsByChannel.get(channelId);
    const current = list?.[list.length - 1];
    if (!list || !current) throw new DataError("NO_CONFIG", "Нет конфига канала.");
    const touchesReputation = patch.reputation !== undefined;
    if (touchesReputation) {
      // Смена формулы → НОВАЯ версия. Прошлые события не пересчитываются (банкинг, ADR/инвариант).
      const version = current.version + 1;
      const next: ChannelConfig = {
        ...current,
        ...patch,
        version,
        hash: `cfg-${channelId}-v${version}`,
        updatedAt: this.now(),
      };
      list.push(next);
      const ch = this.channelsById.get(channelId);
      if (ch) this.channelsById.set(channelId, { ...ch, configVersion: version });
      return next;
    }
    // Косметика (тиры/оверлей/модераторы/...) → версия НЕ растёт.
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
    const cfg = this.latestConfig(channelId);
    const monthAgo = Date.parse(this.now()) - 30 * 86_400_000;
    const inPeriod = (ts: string) => period === "all_time" || Date.parse(ts) >= monthAgo;

    const donors = new Set(
      this.ledger.filter((e) => e.creator === channelId && inPeriod(e.ts)).map((e) => e.donor),
    );
    const entries: LeaderboardEntry[] = [];
    for (const donor of donors) {
      const events = this.eventsFor(donor, channelId).filter((e) => inPeriod(e.ts));
      const points = computePoints(events, cfg.reputation, this.now());
      if (points <= 0) continue;
      const totalDonated = events
        .filter((e) => e.type === "DONATION")
        .reduce((s, e) => s + e.amount, 0n);
      const { tier } = resolveTier(points, cfg.tiers);
      entries.push({
        rank: 0,
        donor,
        displayName: this.profiles.get(donor)?.displayName,
        points,
        tier,
        totalDonated,
      });
    }
    entries.sort((a, b) => b.points - a.points);
    entries.forEach((e, i) => (e.rank = i + 1));
    return period === "top_donor_month" ? entries.slice(0, 1) : entries.slice(0, 50);
  }

  // — Донаты —
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
    if (
      hasText &&
      this.blocks.some((b) => b.channelId === input.channelId && b.blockedAddress === donor)
    ) {
      throw new DataError("BLOCKED", "Этот кошелёк заблокирован на канале для донатов-с-текстом.");
    }

    const fee = (amount * 3n) / 100n;
    const net = amount - fee;
    const isFirst = this.eventsFor(donor, input.channelId).every((e) => e.type !== "DONATION");
    const pointsDelta = bankPoints(amount, cfg.reputation, { isFirstDonation: isFirst });
    const ts = this.now();

    // Деньги финальны сразу; репутация начисляется СРАЗУ, независимо от судьбы текста (инвариант §4).
    const tierBefore = this.standingFor(input.channelId, donor)?.tier.name;
    const donationId = this.nextId("d");
    const donation: Donation = {
      id: donationId,
      channelId: input.channelId,
      donor,
      amount,
      feeAmount: fee,
      netToStreamer: net,
      final: true,
      ts,
    };
    this.ledger.push({
      id: this.nextId("l"),
      donor,
      creator: input.channelId,
      type: "DONATION",
      amount,
      pointsDelta,
      configVersion: cfg.version,
      ts,
    });

    if (hasText) {
      const { verdict, lang } = mockModerate(input.text!.trim());
      const isHardBlock = verdict === "HARD_BLOCK";
      const autoShow = !isHardBlock && cfg.textShowMode === "auto_if_clean" && verdict === "CLEAR";
      const messageId = this.nextId("m");
      const message: MessageRef = {
        id: messageId,
        donationId,
        channelId: input.channelId,
        text: input.text!.trim(),
        lang,
        state: isHardBlock ? "QUARANTINED" : autoShow ? "SHOWN" : "HELD",
        autoVerdict: verdict,
        contentHash: `hash-${messageId}`,
        shownAt: autoShow ? ts : undefined,
        createdAt: ts,
      };
      this.messages.set(messageId, message);
      donation.message = message;
      if (isHardBlock) {
        this.incidents.push({
          id: this.nextId("inc"),
          channelId: input.channelId,
          kind: "hard_block",
          detail: "Авто-карантин: hard-block в тексте доната.",
          ts,
        });
      }
    }
    this.donations.push(donation);

    const standing = this.standingFor(input.channelId, donor)!;
    const tierChanged = tierBefore !== undefined && tierBefore !== standing.tier.name;
    if (donation.message?.state === "SHOWN") {
      this.emitOverlay(input.channelId, { kind: "donation_shown", donation, standing });
    }
    if (tierChanged) this.emitOverlay(input.channelId, { kind: "tier_up", donor, tier: standing.tier });

    return { donation, standing, tierChanged };
  }

  async listDonations(channelId: string, _opts?: ListOpts): Result<Page<Donation>> {
    await this.gate("listDonations");
    const items = this.donations
      .filter((d) => d.channelId === channelId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return { items };
  }

  // — Модерация (HELD + FLAG сверху) —
  async getModerationQueue(channelId: string): Result<MessageRef[]> {
    await this.gate("getModerationQueue");
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
    // Инвариант: трогаем только судьбу текста, НЕ деньги/репутацию.
    const updated: MessageRef = {
      ...msg,
      state,
      shownAt: state === "SHOWN" ? this.now() : msg.shownAt,
    };
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
    return this.blocks.filter((b) => b.channelId === channelId);
  }
  async addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock> {
    await this.gate("addChannelBlock");
    const block: ChannelBlock = {
      channelId,
      blockedAddress: address,
      reason,
      byModerator: this.session().address ?? "unknown",
      ts: this.now(),
    };
    this.blocks.push(block);
    return block;
  }
  async removeChannelBlock(channelId: string, address: Address): Result<void> {
    await this.gate("removeChannelBlock");
    this.blocks = this.blocks.filter(
      (b) => !(b.channelId === channelId && b.blockedAddress === address),
    );
  }

  // — Оператор / T&S —
  async getOperatorQueue(): Result<IncidentLog[]> {
    await this.gate("getOperatorQueue");
    return [...this.incidents].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }
  async applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    await this.gate("applyOperatorAction");
    const full: OperatorAction = {
      ...action,
      id: this.nextId("op"),
      ts: this.now(),
      byOperator: this.session().address ?? "operator",
    };
    this.operatorActions.push(full);

    if (action.action === "ADMIN_VOID" && action.targetAddress && action.targetChannelId) {
      // Единственный путь падения репутации в ядре (инвариант §4.5).
      const events = this.eventsFor(action.targetAddress, action.targetChannelId);
      const cfg = this.latestConfig(action.targetChannelId);
      const points = computePoints(events, cfg.reputation, this.now());
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
