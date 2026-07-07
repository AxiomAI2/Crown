import { OPERATOR_ADDRESS, splitAmount } from "../chain/addresses";
import { verifyPayoutAttestation } from "../chain/attestation";
import { CHANNEL_DESC_MAX, sanitizeChannelLinks } from "../channel-links";
import { computePoints, computePointsAsOf, pointsForAmount, resolveTier } from "../reputation";
import { isLikelyBase58Address, toMicro } from "../utils";
import { dispatchGame, GAME_HANDLERS, GameBusError, type GameContext } from "../../games";
import { DEMO_CHANNELS, DEMO_NAMES, DEMO_TASKS, demoAddress } from "./demo-seed";
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

// R6 (ADR 0012): upper bound of the moderation dedup cache (in-memory stand-in for Postgres). On overflow
// we evict the oldest entries (Map keeps insertion order) — a repeat of evicted content simply
// gets re-evaluated, which does not break correctness.
const MOD_CACHE_CAP = 5000;

/**
 * In-memory backend-store. Identity is a REAL wallet address (Phase 3): no fixtures and no dev identities,
 * realms are created by users, on-chain crowns are accepted via recordDonationFromChain (after the server
 * validates them from the chain). Reign is computed by the shared engine lib/reputation.ts. Persistence is in-memory
 * (a stand-in for Postgres; reset on process restart).
 *
 * `createDonation` (off-chain simulation) is kept for api/mock without a wallet; in chain mode the money goes
 * on-chain and ingest credits it by signature.
 */
/** A viewer's report against shown text (anti-gaming: one per messageId+reporter pair). */
interface ReportRecord {
  messageId: string;
  channelId: string;
  reporter: Address;
  reason?: string;
  ts: string;
}

/** How many unique reports auto-hide shown text (until the streamer/operator decides). */
const REPORT_HIDE_THRESHOLD = 3;

// Length limits for user input (anti-DoS + tidy surfaces). Name/bio are also public.
const PROFILE_LIMITS = { name: 40, bio: 280 };
const REASON_MAX = 500; // reason for a report/operator action/block (free text)

/**
 * Serializable snapshot of the store state for file persistence (server/persist.ts, ADR 0013).
 * Map → entries; bigint survives via codec. Not included: sessionAddress/failMode/latencyScale (runtime),
 * the identity resolver.
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
  gameState: [string, unknown][]; // mini-game state (gameId → opaque slice; ADR 0016)
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
  // Operator override sets (platform moderation). Not persisted directly — they are COMPUTED from
  // operatorActions (the log is the source of truth, it is in the snapshot) via rebuildOperatorOverrides() in __restore.
  // A content takedown (task/message) and a full wallet ban override off-chain logic; on-chain money is
  // not touched by this (§4.1/§4.2 non-custodial) — only visibility and the platform's off-chain actions.
  private operatorBlockedContent = new Set<string>();
  private bannedWallets = new Set<Address>();

  // H1: in chain mode a realm without a valid payout signature is not created (fail-closed). The flag is set by
  // server/store.ts based on CHAIN_MODE (server env) — the class itself is isomorphic and knows no server flags.
  requirePayoutAttestation = false;

  private sessionAddress: Address | null = null;
  // H3: on the server the identity is injected by a resolver (per-request AsyncLocalStorage, see server/store.ts);
  // in the browser mock there is no resolver → sessionAddress is read (set by __setAddress: wallet/dev).
  private identityResolver: (() => Address | null) | null = null;
  private failMode = process.env.NEXT_PUBLIC_MOCK_FAIL === "on";
  private latencyScale = 1;
  private seq = 0;
  private modCache = new Map<string, ModerationVerdict>();
  // Mini-game state: a slice opaque to the core, one per game (the game owns its shape; ADR 0016).
  // Included in the snapshot and the DB (game_state table) — survives restart like the rest of the store.
  private gameState = new Map<string, unknown>();

  // — Infrastructure —
  private now(): string {
    return new Date().toISOString();
  }
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.now()}-${this.seq}`;
  }

  /**
   * DEV-ONLY: fill an EMPTY browser mock with demo content (realms/profiles/crowns/messages) so the
   * screens look like a working product. Idempotent (a repeat call is a no-op). Called ONLY from
   * createDataProvider("mock") in the BROWSER (provider.ts) — the server (api/chain/persist) never comes here.
   * Crowns go through the same accounting (ledger → Reign engine) as real ones. Data — demo-seed.ts.
   */
  seedDemo(): void {
    if (this.channelsById.size > 0) return; // already seeded / store not empty
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    for (const dc of DEMO_CHANNELS) {
      const ownerAddress = demoAddress(dc.owner);
      this.profiles.set(ownerAddress, {
        address: ownerAddress,
        displayName: dc.name,
        avatarUrl: dc.avatar,
        bio: dc.bio,
        links: sanitizeChannelLinks(dc.links),
      });
      const createdAt = iso(150);
      const id = this.nextId("ch");
      this.channelsById.set(id, {
        id,
        ownerAddress,
        payoutAddress: demoAddress(`${dc.owner}-payout`),
        handle: dc.handle,
        status: "ACTIVE",
        activatedAt: createdAt,
        configVersion: 1,
        createdAt,
      });
      this.handleToId.set(dc.handle, id);
      this.configsByChannel.set(id, [
        {
          ...defaultChannelConfig(id),
          description: dc.description,
          nameMode: "allow_display_names", // supporter names are visible in the leaderboard/feed
          enabledGames: dc.enabledGames ?? [], // mini-games the demo realm opts into (defaultChannelConfig leaves this [])
          updatedAt: createdAt,
        },
      ]);
      for (const dn of dc.donations) {
        const donor = demoAddress(dn.donor);
        const name = DEMO_NAMES[dn.donor];
        if (name && !this.profiles.has(donor)) {
          this.profiles.set(donor, { address: donor, displayName: name });
        }
        const ts = iso(dn.daysAgo);
        const amount = toMicro(dn.usdc);
        const { fee, net } = splitAmount(amount);
        const donationId = this.nextId("d");
        const donation: Donation = {
          id: donationId,
          channelId: id,
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
          creator: id,
          type: "DONATION",
          amount,
          pointsDelta: pointsForAmount(amount),
          configVersion: 1,
          ts,
        });
        if (dn.text) {
          const state = dn.state ?? "SHOWN";
          const messageId = this.nextId("m");
          const message: MessageRef = {
            id: messageId,
            donationId,
            channelId: id,
            text: dn.text,
            lang: "en",
            state,
            autoVerdict: "CLEAR",
            contentHash: `demo-${messageId}`,
            shownAt: state === "SHOWN" ? ts : undefined,
            createdAt: ts,
          };
          this.messages.set(messageId, message);
          donation.message = message;
        }
        this.donations.push(donation);
      }
    }

    // Demo escrow tasks (mini-game G3a): a stable spread of statuses so the Games tab and /admin/games show real
    // activity, not zeros. Deadlines are set weeks out ON PURPOSE — the mock's FAST_TEST_WINDOWS (2-min windows)
    // only governs how FRESHLY-created tasks are timed; these carry their own long deadlines, so dueResolution keeps
    // each one in its seeded state instead of expiring ~2 min after load.
    const DAY_MS = 86_400_000;
    const now = Date.now();
    const tasks: EscrowTask[] = [];
    for (const dt of DEMO_TASKS) {
      const channelId = this.handleToId.get(dt.channel);
      if (!channelId) continue; // handle typo / realm without the game — skip defensively
      const createdMs = now - dt.createdDaysAgo * DAY_MS;
      const microStr = toMicro(dt.usdc).toString();
      const task: EscrowTask = {
        id: this.nextId("task"),
        channelId,
        donor: demoAddress(dt.donor),
        amount: microStr,
        text: dt.text,
        createdAt: new Date(createdMs).toISOString(),
        // Far-future delivery deadline → PENDING/ACCEPTED stay open (dueResolution keys on this).
        executionDeadline: new Date(now + 30 * DAY_MS).toISOString(),
        status: dt.status,
        textState: dt.textState ?? "SHOWN",
      };
      if (dt.status === "PENDING" || dt.status === "ACCEPTED") {
        task.graceUntil = new Date(createdMs + 3_600_000).toISOString(); // cancel window long closed
      }
      if (dt.status === "DONE") {
        task.disputeWindowEndsAt = new Date(now + 7 * DAY_MS).toISOString(); // window open → not auto-resolved
      }
      if (dt.status === "DISPUTED" && dt.dispute) {
        task.disputeWindowEndsAt = new Date(createdMs + 3_600_000).toISOString();
        task.dispute = {
          by: demoAddress(dt.dispute.by),
          openedAt: new Date(now - dt.dispute.openedDaysAgo * DAY_MS).toISOString(),
          votingEndsAt: new Date(now + 5 * DAY_MS).toISOString(), // voting open → not auto-resolved
          quorum: dt.dispute.quorum,
          votes: dt.dispute.votes.map((v) => ({
            voter: demoAddress(v.voter),
            choice: v.choice,
            weight: v.weight,
            at: new Date(now - v.daysAgo * DAY_MS).toISOString(),
          })),
        };
      }
      if (dt.status === "RESOLVED" && dt.resolution) {
        const resolvedAt = new Date(now - dt.resolution.resolvedDaysAgo * DAY_MS).toISOString();
        task.resolution = {
          outcome: dt.resolution.outcome,
          reason: dt.resolution.reason,
          resolvedAt,
          claimed: true,
        };
        // A delivered task credits the donor's Reign in this realm — bank it like the game bus does (repEffects →
        // DONATION → bankLedger), so the leaderboard matches the donor's points log. A refund grants nothing (§8).
        if (dt.resolution.outcome === "to_streamer") {
          const micro = toMicro(dt.usdc);
          this.ledger.push({
            id: this.nextId("gl"),
            donor: task.donor,
            creator: channelId,
            type: "DONATION",
            amount: micro,
            pointsDelta: pointsForAmount(micro),
            configVersion: 1,
            ts: resolvedAt,
          });
        }
      }
      tasks.push(task);
    }
    this.gameState.set("escrow-task", { tasks });
  }
  private async gate(method: string): Promise<void> {
    // On the server latencyScale=0 and failMode is off → no delay, no fault injection: we skip all the work
    // (R8/ADR 0012). The identity is carried per-request via AsyncLocalStorage (ADR 0010), without overwriting anyone else's.
    if (this.latencyScale === 0 && !this.failMode) return;
    let h = 0;
    for (const ch of method) h = (h * 31 + ch.charCodeAt(0)) % 997;
    const ms = (120 + (h / 997) * 380) * this.latencyScale;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    if (this.failMode && FAILABLE.has(method)) {
      throw new DataError("MOCK_FAIL", `Failure (${method}) — for testing error states.`);
    }
  }
  private latestConfig(channelId: string): ChannelConfig {
    const list = this.configsByChannel.get(channelId);
    const last = list?.[list.length - 1];
    if (!last) throw new DataError("NO_CONFIG", `No config for realm ${channelId}`);
    return last;
  }
  private eventsFor(donor: Address, channelId: string) {
    return this.ledger.filter((e) => e.donor === donor && e.creator === channelId);
  }
  /** The request identity: resolver (server, per-request) or the sessionAddress field (browser mock). */
  private currentAddress(): Address | null {
    return this.identityResolver ? this.identityResolver() : this.sessionAddress;
  }
  private session(): Session {
    const address = this.currentAddress();
    if (!address)
      return { address: null, isCreator: false, isOperator: false };
    const isCreator = [...this.channelsById.values()].some((c) => c.ownerAddress === address);
    // C2: an empty OPERATOR_ADDRESS (prod without an explicit env) must not grant operator rights.
    const isOperator = Boolean(OPERATOR_ADDRESS) && address === OPERATOR_ADDRESS;
    return { address, isCreator, isOperator };
  }

  // — Authorization. Identity = the VERIFIED session address (set from the SIWS token, see server/auth.ts).
  // Before these checks anyone could send `address` in the body and impersonate the operator/owner (hole C1/C3).
  private requireSession(): Address {
    const addr = this.currentAddress();
    if (!addr) throw new DataError("NO_SESSION", "Connect your wallet and sign in first (signature).");
    return addr;
  }
  private requireOperator(): Address {
    const addr = this.requireSession();
    // An empty OPERATOR_ADDRESS (prod without an explicit env, C2) → no operator, deny everyone (fail-closed).
    if (!OPERATOR_ADDRESS || addr !== OPERATOR_ADDRESS) {
      throw new DataError("FORBIDDEN", "This action is available only to the platform operator.");
    }
    return addr;
  }
  private channelOr404(channelId: string): Channel {
    const ch = this.channelsById.get(channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Realm not found.");
    return ch;
  }
  private requireChannelOwner(channelId: string): Channel {
    const addr = this.requireSession();
    const ch = this.channelOr404(channelId);
    if (ch.ownerAddress !== addr) {
      throw new DataError("FORBIDDEN", "Only the realm owner can do this.");
    }
    return ch;
  }
  /** Realm owner or moderator. needBlock → requires the queue_and_block scope (ban operations). */
  private requireChannelManager(channelId: string, needBlock = false): Channel {
    const addr = this.requireSession();
    const ch = this.channelOr404(channelId);
    if (ch.ownerAddress === addr) return ch;
    const mod = this.latestConfig(channelId).moderators.find((m) => m.address === addr);
    if (!mod || (needBlock && mod.scope !== "queue_and_block")) {
      throw new DataError("FORBIDDEN", "You need moderator rights for this realm.");
    }
    return ch;
  }
  /** Does not throw — for redacting private text in public reads (invariant §4.6). */
  private isChannelManager(channelId: string): boolean {
    const addr = this.currentAddress();
    if (!addr) return false;
    const ch = this.channelsById.get(channelId);
    if (!ch) return false;
    if (ch.ownerAddress === addr) return true;
    const cfg = this.configsByChannel.get(channelId)?.slice(-1)[0];
    return Boolean(cfg?.moderators.some((m) => m.address === addr));
  }
  /** Private text (HELD/HIDDEN/QUARANTINED) is visible only to realm managers; otherwise we strip it (§4.6). */
  private redactDonation(d: Donation, isManager: boolean): Donation {
    const m = d.message;
    if (!m) return d;
    // An operator takedown of a message — unpublished for EVERYONE, even for a realm manager (overrides
    // the role). Otherwise the streamer would still see the illegal content the operator took down.
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

  // — Dev/address injection (outside the interface) —
  __setAddress(address: Address | null) {
    this.sessionAddress = address;
  }
  /** H3: inject the identity resolver (server). The browser mock does not call it → the sessionAddress field stays. */
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

  // — Persistence (ADR 0013): snapshot/restore for the file store (server/persist.ts) —
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
    this.rebuildOperatorOverrides(); // takedowns/bans — from the restored operator-actions log
  }
  /** Rebuilds the override sets (content takedown, full wallet ban) from the operator-actions log —
   * the single source of truth (persisted), "the last action per target wins". Realm blocks live in
   * this.blocks (persisted separately) — we do not touch them here. */
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
  /** Full wallet ban by the operator: a banned wallet does not create realms, does not crown off-chain, and does not play.
   * On-chain money cannot be stopped this way (non-custodial) — the gate closes off the platform's off-chain actions. */
  private requireNotBanned(addr: Address | null): void {
    if (addr && this.bannedWallets.has(addr))
      throw new DataError("WALLET_BANNED", "This wallet is banned by the platform operator.");
  }

  // — Session / identity —
  async getSession(): Result<Session> {
    await this.gate("getSession");
    return this.session();
  }
  async connect(): Result<Session> {
    await this.gate("connect");
    return this.session(); // the address is set via __setAddress (wallet/dev)
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
    if (!addr) throw new DataError("NO_SESSION", "Connect your wallet first.");
    // Length limits (anti-DoS).
    if ((patch.displayName?.length ?? 0) > PROFILE_LIMITS.name)
      throw new DataError("TOO_LONG", `Name — up to ${PROFILE_LIMITS.name} characters.`);
    if ((patch.bio?.length ?? 0) > PROFILE_LIMITS.bio)
      throw new DataError("TOO_LONG", `Bio — up to ${PROFILE_LIMITS.bio} characters.`);
    // Moderation of PUBLIC fields (name/bio are visible in the feed and leaderboard): banned/hard content → reject. Profanity is fine.
    const publicText = [patch.displayName, patch.bio].filter(Boolean).join(" ").trim();
    if (publicText && (await resolveAutoModerator().classify(publicText, "")) === "HARD_BLOCK")
      throw new DataError(
        "PROFILE_BLOCKED",
        "The profile did not pass moderation (banned/hard content).",
      );
    // Avatar enabled (at the owner's discretion): an http(s) link OR an uploaded crop data:image (base64).
    const safePatch: Partial<LightProfile> = { ...patch };
    if (patch.avatarUrl !== undefined) {
      const a = patch.avatarUrl.trim();
      const okHttp = /^https?:\/\//i.test(a) && a.length <= 512;
      const okData = /^data:image\/(png|jpe?g|webp|gif);/i.test(a) && a.length <= 500_000; // ~256² jpeg crop
      safePatch.avatarUrl = a && (okHttp || okData) ? a : undefined;
    }
    // Platform links — only a profile/channel on allowlist domains (same as a realm); a foreign URL is dropped.
    if (patch.links !== undefined) safePatch.links = sanitizeChannelLinks(patch.links);
    const updated: LightProfile = {
      ...(this.profiles.get(addr) ?? { address: addr }),
      ...safePatch,
      address: addr,
    };
    this.profiles.set(addr, updated);
    return updated;
  }

  // — Discovery / realms —
  async listChannels(_opts?: ListOpts): Result<Page<ChannelCard>> {
    await this.gate("listChannels");
    // Crown volume over the last 7 days per realm (showcase sort / momentum). One pass over the ledger
    // (creator = channelId); the window uses the same store clock that ages demo crowns.
    const now = Date.parse(this.now());
    const weekAgo = now - 7 * 86_400_000;
    const crowned7dByChannel = new Map<string, bigint>();
    // Daily crowned (USDC) over the last 14 days per realm — a small momentum sparkline on each card.
    const SPARK_DAYS = 14;
    const sparkStart = now - SPARK_DAYS * 86_400_000;
    const sparkByChannel = new Map<string, number[]>();
    for (const e of this.ledger) {
      if (e.type !== "DONATION") continue;
      const t = Date.parse(e.ts);
      if (t >= weekAgo) crowned7dByChannel.set(e.creator, (crowned7dByChannel.get(e.creator) ?? 0n) + e.amount);
      if (t >= sparkStart) {
        const idx = Math.min(SPARK_DAYS - 1, Math.max(0, Math.floor((t - sparkStart) / 86_400_000)));
        let arr = sparkByChannel.get(e.creator);
        if (!arr) {
          arr = new Array(SPARK_DAYS).fill(0);
          sparkByChannel.set(e.creator, arr);
        }
        arr[idx] = (arr[idx] ?? 0) + Number(e.amount) / 1_000_000;
      }
    }
    const items: ChannelCard[] = [...this.channelsById.values()]
      // We also show BASIC (without activation) — activation only unlocks crown-with-text, not the listing itself.
      // Only SUSPENDED/BANNED are hidden.
      .filter((c) => c.status === "ACTIVE" || c.status === "BASIC")
      .map((c) => {
        const cfg = this.latestConfig(c.id);
        const board = this.computeLeaderboard(c.id, "all_time");
        const top = board[0];
        // The realm's name and links = the OWNER's profile (a single name/links for the person), not separate per-realm ones.
        const owner = this.profiles.get(c.ownerAddress);
        const crowned7d = crowned7dByChannel.get(c.id) ?? 0n;
        // «Live» — the core has no real liveness source; mock simulates it deterministically (stable per realm,
        // biased toward realms with recent activity) so the showcase / admin «Live now» isn't a dead zero.
        const idHash = [...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const isLive = crowned7d > 0n && idHash % 3 === 0;
        return {
          channelId: c.id,
          handle: c.handle,
          displayName: owner?.displayName,
          avatarUrl: owner?.avatarUrl,
          payoutAddress: c.payoutAddress,
          links: owner?.links,
          topTierName: top?.tier ? top.tier.name : (cfg.tiers[0]?.name ?? "Novice"),
          donorsCount: board.length,
          totalDonated: board.reduce((s, e) => s + e.totalDonated, 0n),
          crowned7d,
          spark: sparkByChannel.get(c.id),
          topSupporter: top
            ? { address: top.donor, displayName: top.displayName, avatarUrl: top.avatarUrl }
            : undefined,
          isLive,
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
  /** Realms the current session manages: owner OR moderator (for the moderation queue). */
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
  /** ALL realms (any status) — for the operator console: must act on SUSPENDED/BANNED too. */
  async getOperatorChannels(): Result<Channel[]> {
    await this.gate("getOperatorChannels");
    this.requireOperator();
    return [...this.channelsById.values()];
  }
  /** Internal access for ingest (outside the interface). */
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
    this.requireNotBanned(addr); // a wallet banned by the operator does not create realms
    // Validate inputs on the money path: a bad payout would break tx assembly; we normalize the handle and
    // check it against a strict pattern, uniqueness is case-INSENSITIVE (anti-impersonation @Foo/@foo).
    const handle = (input.handle ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
      throw new DataError("BAD_HANDLE", "Handle: 3–32 characters [a-z0-9_].");
    }
    if (!isLikelyBase58Address(input.payoutAddress)) {
      throw new DataError("BAD_PAYOUT", "payoutAddress does not look like a Solana address.");
    }
    if ([...this.channelsById.values()].some((c) => c.ownerAddress === addr))
      throw ErrChannelAlreadyExists;
    if (this.handleToId.has(handle)) {
      throw new DataError("HANDLE_TAKEN", `Handle @${handle} is already taken.`);
    }
    // H1: payout is locked in by the owner's ed25519 signature — the server stops being the source of truth for
    // the payout address (the donor's client verifies the signature itself before assembling the tx). A supplied signature must be
    // valid in any mode; in chain mode its absence is a rejection (fail-closed).
    const attestation = input.payoutAttestation;
    if (attestation !== undefined && !verifyPayoutAttestation(addr, input.payoutAddress, attestation))
      throw new DataError("BAD_ATTESTATION", "The payout address signature failed verification.");
    if (this.requirePayoutAttestation && !attestation)
      throw new DataError(
        "PAYOUT_UNATTESTED",
        "The payout address must be signed by the owner's wallet (attestPayout).",
      );
    const id = this.nextId("ch");
    const channel: Channel = {
      id,
      ownerAddress: addr,
      payoutAddress: input.payoutAddress,
      payoutAttestation: attestation,
      handle,
      // Activation fee removed — realms are ACTIVE on creation (crowns-with-text + public indexing unlocked,
      // no one-time $2 gate). BASIC no longer occurs in mock; the status banner has no activation prompt.
      status: "ACTIVE",
      activatedAt: this.now(),
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
   * Activation from an on-chain payment (server/ingest.ts): no session — identity/right already checked by the server
   * (payer === ownerAddress). Idempotent: re-accepting the same tx does not change an already active realm.
   */
  activateFromChain(channelId: string): Channel | null {
    const ch = this.channelsById.get(channelId);
    if (!ch) return null;
    if (ch.status === "ACTIVE") return ch;
    const updated: Channel = { ...ch, status: "ACTIVE", activatedAt: this.now() };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  /** H1: additionally lock in the payout of an EXISTING realm with the owner's signature (realms created before attestations). */
  async attestPayout(channelId: string, signatureB64?: string): Result<Channel> {
    await this.gate("attestPayout");
    const ch = this.requireChannelOwner(channelId);
    if (!signatureB64 || !verifyPayoutAttestation(ch.ownerAddress, ch.payoutAddress, signatureB64))
      throw new DataError("BAD_ATTESTATION", "The payout address signature failed verification.");
    const updated: Channel = { ...ch, payoutAttestation: signatureB64 };
    this.channelsById.set(channelId, updated);
    return updated;
  }
  async updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    await this.gate("updateChannelConfig");
    this.requireChannelOwner(channelId);
    const list = this.configsByChannel.get(channelId);
    const current = list?.[list.length - 1];
    if (!list || !current) throw new DataError("NO_CONFIG", "No realm config.");
    // Cap on the number of tiers (anti-"infinite list"; a safety net on top of the UI).
    if (patch.tiers && patch.tiers.length > MAX_TIERS)
      throw new DataError("TOO_MANY_TIERS", `No more than ${MAX_TIERS} tiers.`);
    // Tier descriptions (UGC, optional) — the same limit style and moderation as the realm description.
    if (patch.tiers) {
      for (const t of patch.tiers) {
        const d = t.description?.trim();
        if (!d) continue;
        if (d.length > TIER_DESC_MAX)
          throw new DataError("TOO_LONG", `Tier description — up to ${TIER_DESC_MAX} characters.`);
        if ((await resolveAutoModerator().classify(d, "")) === "HARD_BLOCK")
          throw new DataError(
            "CHANNEL_BLOCKED",
            "The tier description did not pass moderation (banned/hard content).",
          );
      }
    }
    // §10: Reign thresholds (task/dispute) — non-negative finite numbers, a sane cap (a safety net
    // on top of the UI). They gate the right to send a task / raise a dispute, not the weight or the outcome.
    for (const [k, v] of [
      ["minReputationToTask", patch.minReputationToTask],
      ["minReputationToDispute", patch.minReputationToDispute],
    ] as const) {
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0 || v > 1_000_000_000)
        throw new DataError("BAD_CONFIG", `Reign threshold (${k}) — a non-negative number.`);
    }
    // Realm description (UGC): limit + moderation. The realm's name/links live in the owner's profile, not here.
    if (patch.description !== undefined && patch.description.length > CHANNEL_DESC_MAX)
      throw new DataError("TOO_LONG", `Description — up to ${CHANNEL_DESC_MAX} characters.`);
    if (
      patch.description &&
      (await resolveAutoModerator().classify(patch.description, "")) === "HARD_BLOCK"
    )
      throw new DataError(
        "CHANNEL_BLOCKED",
        "The description did not pass moderation (banned/hard content).",
      );
    // The Reign rate is fixed → nothing to version. Tiers/minimums/settings apply immediately.
    const updated: ChannelConfig = { ...current, ...patch, updatedAt: this.now() };
    list[list.length - 1] = updated;
    return updated;
  }

  // — Reign / status —
  async getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    await this.gate("getStanding");
    return this.standingFor(channelId, donor);
  }
  async getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    await this.gate("getLeaderboard");
    return this.computeLeaderboard(channelId, period);
  }
  /** Addresses blocked on the realm — for suppressing text publication and anonymizing the name. */
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
      // addresses_only OR blocked → we do not return public identity (name/avatar); the UI shows a short address.
      const showIdentity = cfg.nameMode === "allow_display_names" && !blocked.has(donor);
      const prof = showIdentity ? this.profiles.get(donor) : undefined;
      entries.push({
        rank: 0,
        donor,
        displayName: prof?.displayName,
        avatarUrl: prof?.avatarUrl,
        points,
        tier: resolveTier(points, cfg.tiers).tier,
        totalDonated,
      });
    }
    // §4.4 determinism: when points are equal the rank must NOT depend on log order. Secondary keys —
    // crowned more, then address (unique) → a total order, independently recomputable.
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
    // All realms where the donor has events (meaning there is standing). We traverse the ledger directly — the profile
    // shows the donor's ENTIRE history, including realms outside discovery (SUSPENDED/BANNED).
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
      // Position in THIS realm's leaderboard (ranked by Reign) — for the trophy page: "#N" and, at #1,
      // "The Crown of @realm". The board is the same one the leaderboard/rail show (dedup via cache).
      const board = this.computeLeaderboard(channelId, "all_time");
      const idx = board.findIndex((e) => e.donor === address);
      standings.push({
        channelId,
        handle: ch.handle,
        channelName: this.profiles.get(ch.ownerAddress)?.displayName,
        tier: s.tier,
        rank: idx >= 0 ? idx + 1 : undefined,
        supporters: board.length,
        points: s.points,
        totalDonated: s.totalDonated,
        donationCount: myDonations.length,
        firstDonationAt: s.firstDonationAt,
        lastDonationAt,
      });
    }
    // Positions — by descending crown total (like "by value" on polymarket).
    standings.sort((a, b) =>
      b.totalDonated > a.totalDonated ? 1 : b.totalDonated < a.totalDonated ? -1 : 0,
    );

    // Activity: all of the donor's crowns across all realms, newest first. Text is private (viewer is not a manager) → we redact.
    const donations = this.donations
      .filter((d) => d.donor === address)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((d) => {
        const r = this.redactDonation(d, false);
        const prof = this.profiles.get(d.donor);
        return prof?.displayName || prof?.avatarUrl
          ? { ...r, donorName: prof?.displayName, donorAvatarUrl: prof?.avatarUrl }
          : r;
      });

    // The donor's points log: what points were CREDITED for (crowns + escrow tasks that landed), newest first.
    // Protocol dispute events (DISPUTE_*) live in the game layer, not in this feed; there are no operator deductions (CR-1).
    const donationEvents: DonorPointEvent[] = donations.map((d) => ({
      id: d.id,
      channelId: d.channelId,
      type: "DONATION" as const,
      pointsDelta: pointsForAmount(d.amount),
      amount: d.amount,
      ts: d.ts,
      txSignature: d.txSignature,
      message: d.message,
    }));
    // The donor's escrow tasks that reached the streamer (to_streamer) — also a crown (GAME_DONATION, §4.7/repEffects).
    // The task text is skin: we show it ONLY if public (SHOWN and not taken down by the operator), parity with redactDonation.
    const escrowTasks =
      (this.gameState.get("escrow-task") as { tasks: EscrowTask[] } | undefined)?.tasks ?? [];
    const escrowEvents: DonorPointEvent[] = escrowTasks
      .filter(
        (t) =>
          t.donor === address &&
          t.status === "RESOLVED" &&
          t.resolution?.outcome === "to_streamer",
      )
      .map((t) => {
        const amount = BigInt(t.amount);
        const pub = !this.operatorBlockedContent.has(t.id) && (t.textState ?? "SHOWN") === "SHOWN";
        return {
          id: `escrow:${t.escrowTaskId ?? t.id}`,
          channelId: t.channelId,
          type: "GAME_DONATION" as const,
          pointsDelta: pointsForAmount(amount),
          amount,
          ts: t.resolution?.resolvedAt ?? t.createdAt,
          escrowTaskId: t.escrowTaskId,
          message: t.text
            ? {
                id: `escrow-msg:${t.id}`,
                donationId: t.id,
                channelId: t.channelId,
                text: pub ? t.text : "",
                state: pub ? "SHOWN" : (t.textState ?? "HELD"),
                contentHash: t.escrowTaskId ?? "",
                createdAt: t.createdAt,
              }
            : undefined,
        };
      });
    const pointEvents: DonorPointEvent[] = [...donationEvents, ...escrowEvents].sort((a, b) =>
      a.ts < b.ts ? 1 : -1,
    );

    const totalDonated = standings.reduce((sum, x) => sum + x.totalDonated, 0n);
    const firstDonationAt = donations.reduce<string | undefined>(
      (min, d) => (min && min < d.ts ? min : d.ts),
      undefined,
    );
    // "Top tier" = the realm with the highest LOCAL points. This is NOT a global ranking (§4.3) — just
    // the donor's best achievement somewhere, for a badge. We do not sum points across realms.
    const topStanding = standings.reduce<DonorChannelStanding | undefined>(
      (best, x) => (!best || x.points > best.points ? x : best),
      undefined,
    );
    // Whether this address owns a realm (one per wallet, ADR 0002) — so the profile can link to the realm.
    const ownedChannel = [...this.channelsById.values()].find((c) => c.ownerAddress === address);

    const ownProfile = this.profiles.get(address);
    return {
      address,
      displayName: ownProfile?.displayName,
      avatarUrl: ownProfile?.avatarUrl,
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
   * Home feed (ADR 0018): my open escrow cycles (by urgency) + what's hot (by DISTINCT participants).
   * Identity comes from the SESSION (not a parameter): cycles carry YOUR task text, reading someone else's address is not allowed (§4.6).
   * For now it accounts for the `escrow-task` game (the only one) — extensible to other games.
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
      // Urgency: "act now" (claimable → window closing) → "waiting on others"; within — by deadline.
      const rank = (c: OpenCycle) => (c.kind === "claimable" ? 0 : c.actionable ? 1 : 2);
      cycles.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.deadline ? Date.parse(a.deadline) : 0) - (b.deadline ? Date.parse(b.deadline) : 0),
      );
    }
    return { cycles, live: this.liveChannels(tasks, now) };
  }

  /** The donor's open cycle for a task (null — the cycle is closed: went to the streamer / already claimed). */
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

  /** Live realms for the strip: ranked by DISTINCT participants → velocity → activity (NOT by amount — §4.3/ADR 0018). */
  private liveChannels(tasks: EscrowTask[], now: number): LiveChannel[] {
    const RECENT_MS = 24 * 3_600_000;
    const agg = new Map<
      string,
      { handle: string; active: number; donors: Set<Address>; locked: bigint; velocity: number }
    >();
    for (const t of tasks) {
      if (t.status === "RESOLVED") continue; // not live
      const ch = this.channelsById.get(t.channelId);
      if (!ch || ch.status !== "ACTIVE") continue; // only public active ones
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

  // — Crowns —
  /** Off-chain simulation (api/mock without a wallet). Not used in chain mode. */
  async createDonation(input: DonationInput): Result<DonationResult> {
    await this.gate("createDonation");
    const donor = this.session().address;
    if (!donor) throw new DataError("NO_SESSION", "Connect your wallet first to crown.");
    this.requireNotBanned(donor); // a wallet banned by the operator does not crown (off-chain path)
    const ch = this.channelsById.get(input.channelId);
    if (!ch) throw new DataError("NO_CHANNEL", "Realm not found.");
    const cfg = this.latestConfig(input.channelId);
    const hasText = Boolean(input.text && input.text.trim());
    // B4: text length limit (like the trustless intake in server/ingest.ts) — otherwise a megabyte of text would settle in
    // the store and get run through OpenAI moderation every time (DoS/amplification).
    if (hasText && input.text!.trim().length > cfg.messageMaxLen)
      throw new DataError("TOO_LONG", "The crown text exceeds the realm's limit.");
    const amount = toMicro(input.amountUSDC);
    const min = hasText ? cfg.minDonationWithText : cfg.minDonation;
    if (amount < min) throw new DataError("BELOW_MIN", "The amount is below the realm's minimum.");
    if (hasText && ch.status !== "ACTIVE") throw ErrTextRequiresActiveChannel;
    if (
      hasText &&
      this.blocks.some((b) => b.channelId === input.channelId && b.blockedAddress === donor)
    ) {
      throw new DataError("BLOCKED", "This wallet is blocked on the realm for crowns-with-text.");
    }
    const { fee, net } = splitAmount(amount); // single source of the rate (addresses.ts), we do not duplicate the 3%
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
   * Records an on-chain crown (after the server validates it from the chain). Idempotent by signature. `text` is
   * already verified against the hash from the memo (see server/ingest.ts); if the crown was already accepted without text and the text
   * arrived later (client/indexer in different order) — we attach the message to the existing crown.
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
    // B1: serialize by signature — the dedup below is "found → await(moderation) → wrote", and without a queue two
    // parallel intakes of one signature (client RPC + indexer polling) would both pass find and record the
    // crown+Reign twice for one payment. A queue by signature → the second sees existing (dedup/late text).
    return this.runSerialized(this.ingestTails, params.signature, async () => {
      const existing = this.donations.find((d) => d.txSignature === params.signature);
      if (existing) {
        const blocked = this.blocks.some(
          (b) => b.channelId === existing.channelId && b.blockedAddress === existing.donor,
        );
        if (params.text && !existing.message && !blocked) {
          // Late attachment of text to an already accepted crown (client/indexer arrived in different order).
          await this.buildMessage(existing, params.text, this.now());
          const standing = this.standingFor(existing.channelId, existing.donor)!; // the crown is already in the log
          return { donation: existing, standing, tierChanged: false }; // R7 (ADR 0012): success, not null
        }
        return null; // duplicate signature without new text — idempotent, nothing to add
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

  /** Creates a message for a crown: run moderation (async — the auto layer may call OpenAI), dedup,
   *  quarantine incident. Attaches donation.message. */
  private async buildMessage(donation: Donation, text: string, ts: string): Promise<MessageRef> {
    const cfg = this.latestConfig(donation.channelId);
    const { verdict, lang, contentHash, deduped } = await runPipeline(text, this.modCache, {
      scope: donation.channelId,
      auto: resolveAutoModerator(), // OpenAI when OPENAI_API_KEY is present, otherwise a local dictionary
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
        address: donation.donor, // the content author — whom to act on
        kind: "hard_block",
        detail: "Auto-quarantine: banned content in the crown text.",
        text,
        ts,
      });
    }
    return message;
  }

  /** Shared crown recording: bank the points IMMEDIATELY, text → HELD/moderation (invariants §4). Async: text
   *  moderation may call OpenAI (see buildMessage). Points/log are banked independently of the text (§4.7). */
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
    // Realm blocklist: for a blocked wallet we do not publish crown-with-text. The off-chain createDonation
    // rejects it up front; in chain on-chain money is final → we accept the crown but strip the TEXT (no message created).
    const blocked = this.blocks.some(
      (b) => b.channelId === p.channelId && b.blockedAddress === p.donor,
    );
    const pointsDelta = pointsForAmount(p.amount); // fixed: 1 USDC = 1 point
    const ts = this.now();
    // The "before" baseline for a new donor is the zero-points tier (usually "Novice"): a first crown that immediately gives
    // a higher tier honestly triggers a tier-up (previously tierChanged on the first crown was always false).
    const tierBefore = (
      this.standingFor(p.channelId, p.donor)?.tier ??
      resolveTier(0, this.latestConfig(p.channelId).tiers).tier
    )?.name;
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
    const tierChanged = tierBefore !== standing.tier?.name;
    return { donation, standing, tierChanged };
  }

  /**
   * Preflight of the crown text BEFORE sending it on-chain (outside DataProvider; called by the chain layer before signing).
   * blocked=true only on HARD_BLOCK (banned/hard) — same as for a name. Profanity is allowed → we do not block.
   * This is not a "money decision": the tx has not been sent yet. Ingest runs moderation again anyway (a backstop).
   */
  async precheckText(
    text: string,
    channelId?: string,
    kind: "message" | "task" = "message",
  ): Result<{ blocked: boolean; reason?: "content" | "blocklist" }> {
    await this.gate("precheckText");
    // Realm blocklist: a blocked wallet cannot crown-with-text — we catch it BEFORE signing (money is not spent).
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
    // B4: we do not send unbounded text to moderation (DoS/OpenAI amplification) — we clip it to the realm limit
    // (the same text still gets capped later in createDonation). Without a realm — a reasonable cap.
    const maxLen =
      channelId && this.configsByChannel.has(channelId)
        ? this.latestConfig(channelId).messageMaxLen
        : 2000;
    // A TASK (escrow-task) is paid on-chain BEFORE recording → the preflight must judge by the SAME strict policy
    // as the server-side create (classifyTaskText: + LLM legality), otherwise a weak preflight would let an illegal
    // task through, the escrow would get funded, and create would reject it → an orphaned escrow (money locked, no task).
    // Too long we treat as a block BEFORE the AI (do not fund). classifyTaskText is memoized by hash — the same input
    // → the same verdict on the server-side create (AI non-determinism will not "flip" the decision after funding).
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
    // Realm name mode: addresses_only → do NOT show names (even from the profile), only addresses.
    const showNames =
      this.configsByChannel.has(channelId) &&
      this.latestConfig(channelId).nameMode === "allow_display_names";
    // Those blocked on the realm — always by address only, we do not show a name (even with allow_display_names).
    const blocked = this.blockedSet(channelId);
    const items = this.donations
      .filter((d) => d.channelId === channelId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((d) => {
        const r = this.redactDonation(d, isManager);
        const prof = showNames && !blocked.has(d.donor) ? this.profiles.get(d.donor) : undefined;
        return prof?.displayName || prof?.avatarUrl
          ? { ...r, donorName: prof?.displayName, donorAvatarUrl: prof?.avatarUrl }
          : r;
      });
    return { items };
  }

  // — Moderation —
  async getModerationQueue(channelId: string): Result<MessageRef[]> {
    await this.gate("getModerationQueue");
    this.requireChannelManager(channelId); // private text — managers only (§4.6)
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
    if (!msg) throw new DataError("NO_MESSAGE", "Message not found.");
    this.requireChannelManager(msg.channelId); // show/hide — a publication decision, managers only
    // An operator takedown overrides the streamer: a message taken down by the operator cannot be shown back by them.
    if (state === "SHOWN" && this.operatorBlockedContent.has(messageId))
      throw new DataError("BLOCKED_BY_OPERATOR", "The message was taken down by the platform operator — it cannot be shown.");
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
  /** Hide ALL of a donor's messages on the realm (with one button). Manager only; money/standing are not touched. */
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
   * A viewer's report against SHOWN text. Any signed-in user, one report per message per address (anti-gaming).
   * The first report → an incident for the streamer/operator; at the unique-report threshold the text auto-hides (HIDDEN)
   * until a human decides. Money/Reign are not touched (§4.7). You can only report shown text (§4.6).
   */
  async reportMessage(
    messageId: string,
    reason?: string,
  ): Result<{ reports: number; hidden: boolean }> {
    await this.gate("reportMessage");
    const reporter = this.requireSession();
    const msg = this.messages.get(messageId);
    if (!msg) throw new DataError("NO_MESSAGE", "Message not found.");
    // Shown text can be reported by any signed-in user; NON-shown (HELD/quarantine) — only a realm manager
    // (escalation to T&S from the moderation queue).
    if (msg.state !== "SHOWN" && !this.isChannelManager(msg.channelId)) {
      throw new DataError(
        "NOT_REPORTABLE",
        "You can report shown text or from the moderation queue.",
      );
    }
    if (this.reports.some((r) => r.messageId === messageId && r.reporter === reporter)) {
      throw new DataError("ALREADY_REPORTED", "You have already reported this message.");
    }
    reason = reason?.slice(0, REASON_MAX); // clamp the reason length (free text)
    const ts = this.now();
    const author = this.donations.find((d) => d.id === msg.donationId)?.donor; // the content author
    this.reports.push({ messageId, channelId: msg.channelId, reporter, reason, ts });
    const count = this.reports.filter((r) => r.messageId === messageId).length;

    if (count === 1) {
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: msg.channelId,
        address: author,
        kind: "report",
        detail: `Report${reason ? `: ${reason}` : ""}.`,
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
        detail: `Auto-hidden: ${count} report(s). The streamer/operator can review.`,
        text: msg.text,
        ts,
      });
      hidden = true;
    }
    return { reports: count, hidden };
  }

  // — Realm blocklist —
  async getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    await this.gate("getChannelBlocklist");
    this.requireChannelManager(channelId);
    return this.blocks.filter((b) => b.channelId === channelId);
  }
  /** Donor: MY block on this realm (+reason) — for the badge on the crown card. Sees only their own block. */
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
    // R9 (ADR 0012): the right and the author — via explicit calls, not through && (it was fragile: a value from a side effect).
    this.requireChannelManager(channelId, true); // right: owner or moderator with the ban scope
    const byModerator = this.requireSession(); // the address recorded as the ban's author
    const block: ChannelBlock = {
      channelId,
      blockedAddress: address,
      reason: reason?.slice(0, REASON_MAX), // clamp the reason length
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

  // — Operator / T&S —
  async getOperatorQueue(): Result<IncidentLog[]> {
    await this.gate("getOperatorQueue");
    this.requireOperator();
    return [...this.incidents].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }
  async applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    await this.gate("applyOperatorAction");
    const operator = this.requireOperator(); // operator only: ban/freeze realms, takedown (§4.5)
    // A sanction without the required target — not a "silent log" but an explicit error (otherwise the button "worked" but did nothing).
    const need = (ok: boolean, msg: string) => {
      if (!ok) throw new DataError("BAD_TARGET", msg);
    };
    switch (action.action) {
      case "HIDE_MESSAGE":
        need(!!action.targetContentId, "Provide the id of the task or message to unpublish.");
        break;
      case "BAN_WALLET_FULL":
        need(!!action.targetAddress, "Provide the wallet address for a full ban.");
        break;
      case "CHANNEL_BLOCK":
        need(!!action.targetChannelId && !!action.targetAddress, "Realm and wallet address are required.");
        break;
      case "SUSPEND_CHANNEL":
      case "BAN_CREATOR_ROLE":
        need(!!action.targetChannelId, "Provide the realm.");
        break;
      case "REINSTATE_CHANNEL": // reinstatement — lifts a sanction from any target: realm / wallet / content
        need(
          !!action.targetChannelId || !!action.targetAddress || !!action.targetContentId,
          "Provide the reinstatement target (realm, wallet, or content id).",
        );
        break;
    }
    const full: OperatorAction = {
      ...action,
      reason: (action.reason ?? "").slice(0, REASON_MAX), // clamp the reason length
      id: this.nextId("op"),
      ts: this.now(),
      byOperator: operator,
    };
    this.operatorActions.push(full);
    // The operator does NOT edit Reign (CR-1): the punishment is a BLOCK (wallet ban/realm block), which
    // devalues Reign without touching the honest, recomputable number (§4.4/§4.5). The only points
    // deduction is the protocol DISPUTE_LOST (a lost false dispute), not an operator button.
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
    // Content takedown: unpublish the task/message FOR GOOD (overrides the streamer and the indexer's auto-reveal
    // — see isContentBlocked/revealFromChain). The set is computed by the rebuild below from the log. For a
    // crown message we additionally clear its state — it leaves the queue/feed immediately (for tasks visibility
    // is driven entirely by the override set). We do not touch on-chain money (§4.1/§4.2).
    if (action.action === "HIDE_MESSAGE" && action.targetContentId) {
      const msg = this.messages.get(action.targetContentId);
      if (msg) this.messages.set(msg.id, { ...msg, state: "HIDDEN" });
    }
    // Realm wallet block: we reuse the realm blocklist (this.blocks) — it already gates crown-with-text
    // (precheckText/createDonation) and hides the name. Idempotent (we do not spawn duplicates).
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
    // Reinstatement: the inverse of any sanction for the given target. Realm: SUSPENDED|BANNED → ACTIVE (BASIC we do
    // not touch — otherwise the paid activation fee would be bypassed). Wallet/content are lifted in the rebuild below; the realm
    // block (realm+address) we remove from the blocklist here.
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
    this.rebuildOperatorOverrides(); // content takedown / wallet ban — from the log (the last action wins)
    // A punitive incident — only for sanctions; a reinstatement is a resolution, not an incident (it is in the
    // operatorActions log). Otherwise a "Flood" badge would be misleading.
    if (action.action !== "REINSTATE_CHANNEL") {
      this.incidents.push({
        id: this.nextId("inc"),
        channelId: action.targetChannelId,
        address: action.targetAddress,
        kind: full.reason.includes("CSAM") ? "hard_block" : "flood",
        detail: `Operator action: ${action.action} (${full.reason})`,
        resolution: action.preservation ? "preservation + report" : undefined,
        ts: this.now(),
      });
    }
    return full;
  }

  // — Mini-games (game-bus, ADR 0016) —
  async gameAction(req: GameRequest): Result<unknown> {
    return this.dispatchGameOp("action", req);
  }
  async gameQuery(req: GameRequest): Result<unknown> {
    return this.dispatchGameOp("query", req);
  }
  // — Public export (recomputability §4.4; NOT in the RPC whitelist — served by GET routes /api/v1/export) —

  /**
   * Export of a single realm for independent recomputation: the realm (with payout attestation) + all config versions +
   * the Reign log + the current leaderboard as a checkable figure. Public data only: the log contains no
   * text (§4.6), and the config and leaderboard are read by public methods anyway.
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
   * State slices for the proof anchor (server/anchor.ts): the full log + all config versions (public) and
   * the operator log (incident log + operator actions — they contain private text, only their HASHES go out;
   * the streamer's realm moderators' decisions are not the operator layer and are not anchored). Digests of these slices are periodically published by the on-chain anchor — the past cannot be quietly rewritten.
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

  // Server-side escrow verification hooks (chain). Injected from store.ts (server) so that the server graph
  // (`@/server/escrow-verify` → store-db → PGlite/node:path) does not land in the client bundle. In the browser/mock
  // they are unset → verifyEscrow=true, escrowOutcome is absent (no escrow).
  verifyEscrowHook?: (
    escrowTaskId: string,
    expect: { donor: string; amount: string; streamer?: string },
  ) => Promise<boolean>;
  escrowOutcomeHook?: (escrowTaskId: string) => Promise<"to_streamer" | "to_donor" | null>;
  escrowStateHook?: (escrowTaskId: string) => Promise<number | null>; // ESC-19: raw on-chain state

  // Serialization queues for operations on the shared in-memory store: game mutations by gameId (ESC-15; the game slice
  // is one for ALL realms) and crown intake by signature (B1). They close "read → await → wrote" races
  // (double banking, lost updates) — one writer per key at a time. Growth is bounded by the number of keys.
  private gameActionTails = new Map<string, Promise<void>>();
  private ingestTails = new Map<string, Promise<void>>();
  /** Serializes an operation by key in the given queue: the next one waits for the previous. */
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
   * Shared dispatch of mini-game operations: the realm must exist and the game must be enabled on it (cold-start).
   * Then we route to the game handler via the bus, giving it a narrow context (identity, realm, now, its own
   * state slice). We map bus errors to DataError → they reach the client with a clear code.
   */
  private async dispatchGameOp(kind: "action" | "query", req: GameRequest): Promise<unknown> {
    await this.gate(kind === "action" ? "gameAction" : "gameQuery");
    const cfg = this.latestConfig(req.channelId); // throws NO_CONFIG if the realm does not exist
    // Disabling a game does not erase history and does not break existing rounds: READS (query) and actions on already
    // created tasks (accept/claim/hide/settle — the money must be finalized, history stays in the feed)
    // are always allowed. We block only the CREATION of a new round (create) on a disabled game.
    if (kind === "action" && req.op === "create" && !cfg.enabledGames.includes(req.gameId)) {
      throw new DataError("GAME_NOT_ENABLED", "This mini-game is not enabled on the realm.");
    }
    // A wallet banned by the operator does not play (create/accept/vote, etc.). The background settler calls
    // without an identity (settleDue) → requireNotBanned(null) — no-op, we do not touch the indexer.
    if (kind === "action") this.requireNotBanned(this.currentAddress());
    const exec = async (): Promise<unknown> => {
      const ctx: GameContext = {
        identity: this.currentAddress(),
        channelId: req.channelId,
        channelOwner: this.channelsById.get(req.channelId)?.ownerAddress ?? null,
        channelPayout: this.channelsById.get(req.channelId)?.payoutAddress ?? null,
        // H1: is the payout confirmed by the owner's signature? (the escrow-fund bridge to the chain — the same check ingest
        // does for a regular crown). We precompute it here where the realm is available; the game handler stays crypto-free.
        channelPayoutAttested: ((c) =>
          !!c?.payoutAttestation &&
          verifyPayoutAttestation(c.ownerAddress, c.payoutAddress, c.payoutAttestation))(
          this.channelsById.get(req.channelId),
        ),
        isChannelManager: this.isChannelManager(req.channelId),
        // Realm levers for create (spec §10): a task = a crown with text → the larger of the two minimums.
        minTaskAmountMicro: (cfg.minDonationWithText > cfg.minDonation
          ? cfg.minDonationWithText
          : cfg.minDonation
        ).toString(),
        // §10: Reign thresholds for sending a task / for the right to raise a dispute (streamer levers, anti-spam).
        minReputationToTask: cfg.minReputationToTask,
        minReputationToDispute: cfg.minReputationToDispute,
        textMaxLen: cfg.messageMaxLen,
        now: () => this.now(),
        newId: () => this.nextId("game"),
        state: {
          get: <T = unknown>() => this.gameState.get(req.gameId) as T | undefined,
          set: (value: unknown) => this.gameState.set(req.gameId, value),
        },
        // Bridges into the core (ADR 0015): weight = points at a point in time; banking of game effects into the realm log;
        // moderation of the game's UGC by the same core pipeline (for tasks — the strict policy, classifyTaskText).
        // Vote weight/quorum = points at the snapshot. The operator does not edit Reign (no ADMIN_VOID, CR-1) →
        // the weight is honest; the only deduction is the protocol DISPUTE_LOST (a lost false dispute).
        reputationAsOf: (address, asOf) =>
          computePointsAsOf(this.eventsFor(address, req.channelId), asOf),
        moderate: (text) => classifyTaskText(text),
        textShowMode: cfg.textShowMode, // the same publication policy as crown messages (queue/auto)
        // Server-side escrow verification hooks (ADR 0017/ESC-12) are INJECTED from store.ts (server) — so the server DB/
        // web3.js graph (`@/server/escrow-verify` → store-db → PGlite/node:path) does NOT land in the client bundle of the
        // mock provider. In the browser/mock the hooks are unset → verifyEscrow=true, escrowOutcome is absent (no escrow).
        verifyEscrow: this.verifyEscrowHook ?? (async () => true),
        // CR-4: pure cryptographic commitment check (independent of mode/server) — task_id == SHA-256(nonce ‖ text).
        verifyTextCommitment: async (escrowTaskId, text, nonce) =>
          !!nonce && (await taskTextCommitment(text, nonce)) === escrowTaskId,
        escrowOutcome: this.escrowOutcomeHook,
        escrowState: this.escrowStateHook,
        isContentBlocked: (id) => this.operatorBlockedContent.has(id), // operator takedown (moderation)
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
    // ESC-15: we serialize game mutations by gameId (the slice is shared across all realms — a per-realm lock would not save from
    // a cross-realm race/lost updates); reads do not mutate — no queue.
    return kind === "action" ? this.serializeGameAction(req.gameId, exec) : exec();
  }
}
