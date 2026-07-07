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
 * Result<T> — an async result that THROWS an Error on failure (TanStack Query catches it).
 * (In yellow-paper §11 it's written as `Result<T> = T` for readable signatures; in practice it's a Promise.)
 */
export type Result<T> = Promise<T>;

export type DataSource = "mock" | "api" | "chain" | "icp";

/**
 * The single data-access interface (yellow-paper §11, CLAUDE.md §3).
 * No component ever calls fetch/RPC/Solana — only the methods here, via hooks.
 */
export interface DataProvider {
  // — Session / identity —
  getSession(): Result<Session>;
  connect(): Result<Session>; // Phase 3: wallet-adapter + SIWS
  disconnect(): Result<void>;
  getProfile(address: Address): Result<LightProfile | null>;
  updateProfile(patch: Partial<LightProfile>): Result<LightProfile>;

  // — Discovery / realms —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>>; // only ACTIVE, public
  getChannel(handle: string): Result<Channel | null>;
  getMyChannel(): Result<Channel | null>; // the realm OWNED by the current session (one per wallet, ADR 0002)
  getManagedChannels(): Result<Channel[]>; // realms you manage: owner OR moderator (for the queue)
  getOperatorChannels(): Result<Channel[]>; // ALL realms (any status) — operator only (T&S console)
  getChannelConfig(channelId: string): Result<ChannelConfig>;
  createChannel(input: CreateChannelInput): Result<Channel>; // one realm per wallet (ADR 0002)
  activateChannel(channelId: string): Result<Channel>; // ~$2 charge → BASIC→ACTIVE
  // H1: pin the payout of an existing realm with the owner's ed25519 signature (realms created before
  // attestations). The chain provider signs with the wallet itself (ignores the param); mock/api require a signature.
  attestPayout(channelId: string, signatureB64?: string): Result<Channel>;
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig>;

  // — Reign / status —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null>;
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]>;
  // Per-supporter aggregate for the public profile /u/[address]: standing across realms + activity (read-only).
  getDonorOverview(address: Address): Result<DonorOverview>;
  // Home feed (ADR 0018): your own open cycles + what's hot. Identity comes from the server session (not a param),
  // otherwise someone could read another person's private task text (§4.6).
  homeFeed(): Result<HomeFeed>;

  // — Dispute governance params (migration M1, ADR 0021) — OPTIONAL: the canon lives in the
  // ICP core canister, the methods exist only on IcpDataProvider (icp mode). The UI checks for their presence.
  getDisputeParams?(channelId: string): Result<DisputeParamsInfo>;
  // Dispute over a chain task FROM THE CANISTER (M2): open scoreboard/votes/verdict/on-chain signatures
  // of the resolver. null = no dispute (or a task without escrow). Opening/voting go through gameAction
  // (raiseDispute/vote) — IcpDataProvider routes them into the canister itself via the wallet signature.
  getCanisterDispute?(channelId: string, taskId: string): Result<CanisterDisputeView | null>;
  // A write = the owner's wallet signature over the canonical message (chain/dispute-params.ts) —
  // write permission is verified by the CANISTER against the on-chain owner; the server is not involved.
  setDisputeParams?(channelId: string, params: DisputeParamsValues): Result<DisputeParamsInfo>;

  // — Crowns —
  createDonation(input: DonationInput): Result<DonationResult>;
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>>;

  // — Moderation (streamer/moderators) —
  getModerationQueue(channelId: string): Result<MessageRef[]>;
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef>;
  // Hide ALL of a supporter's messages on a realm (with one button). Money/standing are untouched — display only.
  hideDonorMessages(channelId: string, donor: Address): Result<{ hidden: number }>;
  // A viewer's report on shown text (anyone who's signed in); the report threshold auto-hides + files a T&S incident.
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }>;

  // — Realm blocklist (streamer) —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]>;
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock>;
  removeChannelBlock(channelId: string, address: Address): Result<void>;
  // Supporter: am I blocked on this realm (+reason) — for the banner in the crown card.
  getMyChannelBlock(channelId: string): Result<ChannelBlock | null>;

  // — Operator / T&S (platform level) —
  getOperatorQueue(): Result<IncidentLog[]>;
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction>;

  // — Mini-games: one game-bus for all games (ADR 0016), the interface doesn't grow per game. Routing by
  //   gameId/op happens in the games layer; the result is typed by hooks inside the game module. —
  gameAction(req: GameRequest): Result<unknown>; // mutations
  gameQuery(req: GameRequest): Result<unknown>; // reads
}

// — Domain errors (thrown by the provider, caught by the UI) —
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
  "This wallet already has a realm (one realm per wallet).",
);
export const ErrTextRequiresActiveChannel = new DataError(
  "TEXT_REQUIRES_ACTIVE_CHANNEL",
  "A crown with text is only available on an activated realm.",
);

/** localStorage key of the persisted dev-login address (mock/api only). Written by useDevControls.setAddress;
 *  restored below so a page reload doesn't sign the tester out (the provider is re-created on every load). */
export const DEV_ADDRESS_KEY = "crown.dev.address";

/** Browser-only: restore the persisted dev-login into a freshly created provider. No-op on the server. */
function restoreDevAddress(provider: { __setAddress(address: string | null): void }): void {
  if (typeof window === "undefined") return;
  try {
    const saved = window.localStorage.getItem(DEV_ADDRESS_KEY);
    if (saved) provider.__setAddress(saved);
  } catch {
    /* localStorage unavailable (private mode etc.) — stay signed out */
  }
}

/**
 * Implementation selection by ENV flag (CLAUDE.md §3). Moving between phases =
 * add an implementation of the interface, without touching any screen.
 */
export function createDataProvider(source: string | undefined): DataProvider {
  const s = (source ?? "mock") as DataSource;
  switch (s) {
    case "mock": {
      const provider = new MockDataProvider();
      // DEV: populate the browser mock with demo realms (otherwise the catalog is empty — the demo store was removed from the backend).
      // Browser only (server/persist never reaches here) and only if the seed isn't explicitly disabled.
      if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_DEMO_SEED !== "off") {
        provider.seedDemo();
      }
      restoreDevAddress(provider);
      return provider;
    }
    case "api": {
      const provider = new ApiDataProvider();
      restoreDevAddress(provider);
      return provider;
    }
    case "chain":
    case "icp":
      // Chain/IcpDataProvider ARE IMPLEMENTED, but wired up via a separate path (app/providers.tsx →
      // chain-providers.tsx, dynamic chunk: the Solana stack doesn't land in the mock/api bundle, ADR 0004).
      // They are deliberately not instantiated through this factory — it's for the server/SSR path, where there's no wallet.
      throw new DataError(
        "CHAIN_VIA_PROVIDERS",
        "The chain/icp provider is wired up in app/providers.tsx (ADR 0004).",
      );
    default:
      throw new DataError("BAD_DATA_SOURCE", `Unknown NEXT_PUBLIC_DATA_SOURCE: ${source}`);
  }
}
