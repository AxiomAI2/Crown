/**
 * Canonical core types (docs/yellow-paper.md §13). Used both by the frontend (shape of mock data)
 * and later by the backend (DB schema). Money — micro-USDC (bigint), points — integers.
 * UI-specific types (Session, DonationInput, ChannelCard, ...) — docs/yellow-paper.md §11.
 */

// — Base types —
export type Address = string; // Solana base58, e.g. "7xKp...3fQa"
export type MicroUSDC = bigint; // 1 USDC = 1_000_000n
export type Points = number; // Reign points (fractional, 1:1 to USDC down to cents; micro-precision)
export type Iso = string; // ISO-8601 timestamp
export type TxSignature = string; // Solana transaction signature (Phase 3)

// — Identity and profile —
// Profile is optional: identity is the address; displayName/bio/links are an add-on.
export interface LightProfile {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  links?: ChannelLink[]; // links to platforms (allowlist), same as a realm — see ChannelLink
}

// — Realm —
export type ChannelStatus = "BASIC" | "ACTIVE" | "SUSPENDED" | "BANNED";

export interface Channel {
  id: string; // creator_id
  ownerAddress: Address; // owner's login address (one realm per wallet — ADR 0002)
  payoutAddress: Address; // where crowns go (may != ownerAddress)
  /** ed25519 signature of the owner (base64) over the canonical message "this realm's payout is this address"
   *  (lib/chain/attestation.ts). Lock H1: the server is not the source of truth for the payout address — the
   *  donor client verifies the signature BEFORE assembling the tx, ingest — on crediting. Realms created before
   *  attestation pin the address via attestPayout (button in space settings). */
  payoutAttestation?: string;
  handle: string; // public slug
  status: ChannelStatus; // BASIC until the activation fee is paid
  activatedAt?: Iso;
  configVersion: number;
  createdAt: Iso;
}

// — Realm config —
// The Reign rate is FIXED (1 USDC = 1 point, ADR 0007), not configurable. The streamer only configures
// tiers/thresholds (Tier.threshold) — how many points are needed for perks/participation in mini-games.

export interface Perk {
  label: string;
  condition?: string;
}

export interface Tier {
  name: string;
  threshold: Points; // threshold in points
  color: string; // nickname color
  badge: string; // badge id/key
  description?: string; // opt. tier description (UGC; moderated like the realm description; groundwork for perks/games)
  perks: Perk[];
}

export interface ModeratorRef {
  address: Address;
  scope: "queue" | "queue_and_block";
}

// — Public realm identity —
// Platform from a fixed allowlist; url — canonical https of the profile/channel (validated by domain +
// path pattern in lib/channel-links.ts: an arbitrary URL/deep link cannot be entered).
export type ChannelLinkPlatform =
  | "youtube"
  | "twitch"
  | "kick"
  | "x"
  | "tiktok"
  | "instagram"
  | "discord"
  | "telegram"
  | "onlyfans";

export interface ChannelLink {
  platform: ChannelLinkPlatform;
  url: string;
}

export interface ChannelConfig {
  channelId: string;
  version: number;
  hash: string; // config version (metadata; the Reign rate is fixed, not versioned)
  // Realm name and links are NOT here: the single source of truth is the owner's profile (LightProfile.displayName/
  // links by ownerAddress), so that a person has one nickname and one set of links. Realm-specific is only the
  // description (the realm tagline). Moderated as UGC; inert for Reign (the formula doesn't read it, §4.4).
  description?: string;
  tiers: Tier[];
  minDonation: MicroUSDC;
  minDonationWithText: MicroUSDC;
  /** Min. Reign (points) to send a TASK crown (§10 streamer lever): newcomers send plain crowns and build
   *  standing that way anyway, tasks — only from a threshold. Anti-spam for tasks. 0 = no threshold. */
  minReputationToTask: number;
  /** Min. Reign (points) to raise a DISPUTE (§10 lever "how exclusive is the right to judge my realm"):
   *  anti-trolling ↔ anti-censorship of disputes. Gates the right to raise a dispute, NOT the vote weight or the outcome. 0 = no threshold. */
  minReputationToDispute: number;
  messageMaxLen: number;
  nameMode: "addresses_only" | "allow_display_names";
  textShowMode: "manual" | "auto_if_clean";
  moderators: ModeratorRef[];
  /** Mini-games enabled on the realm — ids from the `src/games` registry (ADR 0016). Empty by default: the streamer
   *  enables a game when the community is ready (cold-start, game spec §8). Stored as opaque strings —
   *  the core doesn't know about specific games; id validation is at the games layer (game-bus, G1.2). */
  enabledGames: string[];
  updatedAt: Iso;
}

// — Reign ledger (source of truth) —
export type LedgerType =
  | "DONATION" // (+) the only source of growth in the core
  | "DISPUTE_WON" // (+) a won dispute (escrow-task game, ADR 0015)
  | "DISPUTE_LOST" // (−) a lost false dispute — the ONLY protocol-level debit (escrow-task game)
  | "GAME" // reserved for future games
  | "REFUND"; // reserved (refund)

export interface LedgerEvent {
  id: string;
  donor: Address;
  creator: string; // channelId
  type: LedgerType;
  amount: MicroUSDC; // crown amount (0 for non-crown events)
  pointsDelta: Points; // contribution to Reign (+/−)
  configVersion: number; // which config version it was banked under
  txSignature?: TxSignature; // Phase 3
  ts: Iso;
}

export interface ViewerStanding {
  channelId: string;
  donor: Address;
  points: Points;
  tier?: Tier; // undefined → fewer points than the first tier's threshold ("no tier")
  nextTier?: Tier;
  progressToNext: number; // 0..1
  totalDonated: MicroUSDC;
  firstDonationAt?: Iso;
}

// — Crown and message —
export type MessageState = "HELD" | "SHOWN" | "HIDDEN" | "QUARANTINED";
export type ModerationVerdict = "CLEAR" | "FLAG" | "HARD_BLOCK";

export interface MessageRef {
  id: string; // msg_ref (goes in the memo)
  donationId: string;
  channelId: string;
  text: string; // offchain, removable
  lang?: string;
  state: MessageState; // default HELD
  autoVerdict?: ModerationVerdict;
  contentHash: string;
  shownAt?: Iso;
  createdAt: Iso;
}

export interface Donation {
  id: string; // donation_id (goes in the memo)
  channelId: string;
  donor: Address;
  amount: MicroUSDC; // full amount (before the split)
  feeAmount: MicroUSDC; // ~3% to the treasury
  netToStreamer: MicroUSDC; // ~97%
  txSignature?: TxSignature; // Phase 3
  final: true; // always true in the core
  ts: Iso;
  message?: MessageRef;
  donorName?: string; // supporter's nickname from the light profile (display only; not written to the ledger)
}

// — Bans and blocks —
export interface ChannelBlock {
  channelId: string;
  blockedAddress: Address;
  reason?: string;
  byModerator: Address;
  ts: Iso;
}

export type PenaltyAction =
  | "HIDE_MESSAGE" // text takedown (visibility; doesn't touch money/Reign)
  | "CHANNEL_BLOCK" // wallet block on a single realm: can't crown-with-text, can't join a game there
  | "SUSPEND_CHANNEL" // realm → SUSPENDED (temporary suspension, reversible)
  | "BAN_CREATOR_ROLE" // realm → BANNED (removes the creator role; the wallet may start a new realm)
  | "BAN_WALLET_FULL" // full wallet ban: doesn't vote/dispute/crown/create — all the value of Reign is zeroed, but the number itself stays honest (§4.4)
  | "REINSTATE_CHANNEL"; // inverse of suspend/ban: SUSPENDED|BANNED → ACTIVE (recovery path)

export interface OperatorAction {
  id: string;
  action: PenaltyAction;
  targetChannelId?: string;
  targetAddress?: Address;
  targetContentId?: string; // HIDE_MESSAGE: id of the task OR crown message being unpublished (takedown)
  reason: string; // CSAM / flood / sanctions / repeat_tos
  byOperator: Address;
  preservation?: boolean;
  reported?: boolean;
  ts: Iso;
}

export interface IncidentLog {
  id: string;
  channelId?: string;
  address?: Address; // address of the content's AUTHOR (supporter) — who the action targets
  kind: "report" | "hard_block" | "sanction_hit" | "flood";
  detail: string;
  text?: string; // offending content (what the incident is about); visible only to the operator in /ops
  resolution?: string;
  ts: Iso;
}

// — Leaderboard (derived) —
export type LeaderboardPeriod = "all_time" | "month";

export interface LeaderboardEntry {
  rank: number;
  donor: Address;
  displayName?: string;
  points: Points;
  tier?: Tier; // undefined → below the first tier's threshold
  totalDonated: MicroUSDC;
}

// — UI-specific types (docs/yellow-paper.md §11) —
export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface ListOpts {
  cursor?: string;
  limit?: number;
}

export interface Session {
  address: Address | null; // null = not connected
  isCreator: boolean; // owns a realm (one per wallet — ADR 0002)
  isOperator: boolean;
}

export interface DonationInput {
  channelId: string;
  amountUSDC: number; // user input in USDC (UI); the provider converts to micro
  text?: string; // opt.; on a BASIC realm → rejected
}

export interface DonationResult {
  donation: Donation;
  standing: ViewerStanding; // the supporter's Reign, recomputed IMMEDIATELY
  tierChanged: boolean; // for the FinalityMoment / tier-up animation
}

export interface ChannelCard {
  channelId: string;
  handle: string;
  displayName?: string; // owner's name (from their profile), not the supporter's nickname
  avatarUrl?: string; // owner's avatar (from the profile); none → monogram letter
  payoutAddress: Address; // payout wallet — shown + link to the explorer
  links?: ChannelLink[]; // owner's socials (mini-icons)
  topTierName: string;
  donorsCount: number;
  totalDonated: MicroUSDC; // total crown volume (from the leaderboard)
  crowned7d?: MicroUSDC; // crown volume over the last 7 days (showcase sort / momentum). Computed by mock; real providers may omit.
  isLive?: boolean; // realm currently «live» — mock-simulated; real providers have no liveness source yet.
  activated: boolean; // ACTIVE → checkmark; BASIC is shown, but without a checkmark and without crowns-with-text
}

export interface CreateChannelInput {
  handle: string;
  payoutAddress: Address;
  /** owner's ed25519 signature over the payout (H1, lib/chain/attestation.ts). Required in chain mode —
   *  the chain provider signs with the wallet transparently when creating a realm. */
  payoutAttestation?: string;
}

// — Mini-games: request via the shared game-bus (ADR 0016). gameId/op — strings; the core doesn't know about
// specific games, routing and validation are at the games layer (`src/games/bus.ts`). —
export interface GameRequest {
  gameId: string;
  channelId: string;
  op: string;
  payload?: unknown;
}

// — Supporter profile: aggregate across all realms (for the public page /u/[address]) —
// IMPORTANT (invariant §4.3): there is no global ranking. Money is aggregatable (crown total is a fact), but
// Reign points stay PER-realm — in the overview we do NOT sum points across realms.
export interface DonorChannelStanding {
  channelId: string;
  handle: string;
  channelName?: string; // realm owner's name (their profile), if set
  tier?: Tier; // undefined → below the first tier's threshold
  points: Points; // local Reign in THIS realm
  totalDonated: MicroUSDC; // crowned to this realm
  donationCount: number;
  firstDonationAt?: Iso;
  lastDonationAt?: Iso;
}

// A supporter's Reign ledger event for the "Activity" feed: what points were GRANTED (+) or DEBITED (−) for.
// The server (mock/api/chain) returns only DONATION; in icp mode the detail comes from the canister ledger —
// which includes task payouts (GAME_DONATION) and protocol dispute outcomes (DISPUTE_*, M2).
// The operator doesn't move points (§4.5, CR-1): a negative delta can only be protocol-level (DISPUTE_LOST).
export interface DonorPointEvent {
  id: string;
  channelId: string;
  type: "DONATION" | "GAME_DONATION" | "DISPUTE_WON" | "DISPUTE_LOST";
  pointsDelta: Points; // signed delta (DISPUTE_LOST < 0)
  amount: MicroUSDC; // money amount of the event (0n for DISPUTE_*)
  ts: Iso;
  txSignature?: TxSignature;
  message?: MessageRef; // private crown/task text (if shown) — for the activity row
  escrowTaskId?: string; // GAME_DONATION: escrow-task seed (CR-4) — the join key for the text in icp mode
  disputeTaskId?: string; // DISPUTE_WON/LOST: off-chain task id — link to the dispute board (proof: who opened it)
}

export interface DonorOverview {
  address: Address;
  totalDonated: MicroUSDC; // sum across all realms (money is aggregatable)
  donationCount: number;
  channelsSupported: number;
  firstDonationAt?: Iso; // "supporting since …" (earliest crown)
  topStanding?: DonorChannelStanding; // realm with the highest LOCAL points (for "top tier", not global)
  ownedChannelHandle?: string; // if this address OWNS a realm (one per wallet, ADR 0002) — its handle
  standings: DonorChannelStanding[]; // positions across realms (by descending crown total)
  donations: Donation[]; // activity: all crowns across all realms, newest first (text is private until shown)
  pointEvents: DonorPointEvent[]; // points ledger: what was granted (+crown) / debited (−void), newest first
}

// — Home as a personal base (ADR 0018) —
/** Stage of an open cycle for the home dashboard (escrow-task). The order is semantically = urgency priority. */
export type CycleKind =
  | "claimable" // money is waiting for you now (RESOLVED → refund to the supporter, not yet claimed)
  | "grace" // can be cancelled (PENDING in the grace window)
  | "dispute_window" // "Done" — the dispute window is open (dispute or wait)
  | "voting" // dispute in progress, voting
  | "awaiting"; // waiting for completion (PENDING/ACCEPTED outside grace)

/** A supporter's open cycle for the `/` dashboard. `text` — YOUR task (supporter), shown to yourself (§4.6 not violated). */
export interface OpenCycle {
  taskId: string;
  channelId: string;
  channelHandle: string;
  kind: CycleKind;
  amount: MicroUSDC;
  text: string;
  deadline?: Iso; // when the current window closes; none → the action is available right now (claimable)
  actionable: boolean; // requires your action now vs waiting on others
}

/** A live realm for the "right now" strip. Rank — by DISTINCT participants, NOT by amount (anti-whale, §4.3/ADR 0018). */
export interface LiveChannel {
  channelId: string;
  handle: string;
  activeCount: number; // live tasks (not RESOLVED)
  participants: number; // distinct supporters in live cycles
  lockedMicro: MicroUSDC; // locked in live cycles (shown, NOT the ranking key)
}

/** Home feed (ADR 0018): your own open cycles (by urgency) + what's hot (by participants). Identity — from the session. */
export interface HomeFeed {
  cycles: OpenCycle[];
  live: LiveChannel[];
}

export type ConfigPatch = Partial<
  Pick<
    ChannelConfig,
    | "description"
    | "tiers"
    | "minDonation"
    | "minDonationWithText"
    | "minReputationToTask"
    | "minReputationToDispute"
    | "messageMaxLen"
    | "nameMode"
    | "textShowMode"
    | "moderators"
    | "enabledGames"
  >
>;
