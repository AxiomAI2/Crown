/**
 * Defaults for NEW realms. Stub realms (lumi/nova/kebab) and dev identities have been removed: an identity
 * is now a real wallet address, and realms are created by real users (Phase 3, ADR 0004/0005).
 */
import { toMicro } from "../utils";
import type { ChannelConfig, Tier } from "./types";

// Cap on the number of tiers per realm (anti-"infinite list"). Default is 5, cap is 20.
export const MAX_TIERS = 20;

// Caps for the realm's banned-words list (anti-DoS on top of the UI).
export const MAX_BLOCKED_WORDS = 200;
export const BLOCKED_WORD_MAX_LEN = 40;

// Length limit for a tier description (UGC, optional). Shorter than a realm description — it's a caption for a tier, not a block of text.
export const TIER_DESC_MAX = 140;

// — Default tiers (yellow-paper §9.1, colors — design-system.md §2). Thresholds are in points (= USDC at
// a 1:1 rate, ADR 0007): $5 / $50 / $500 / $2000 of total crowns. Starting defaults, to be calibrated. —
export const DEFAULT_TIERS: Tier[] = [
  { name: "Rookie", threshold: 0, color: "#9AA1B2", badge: "rookie", perks: [] },
  {
    name: "Regular",
    threshold: 5,
    color: "#7FA7C9",
    badge: "regular",
    perks: [{ label: "Colored nickname" }],
  },
  {
    name: "Frequent",
    threshold: 50,
    color: "#6FC3A6",
    badge: "frequent",
    perks: [{ label: "Chat emoji" }],
  },
  {
    name: "VIP",
    threshold: 500,
    color: "#C9A24B",
    badge: "vip",
    perks: [{ label: "Alert priority" }],
  },
  {
    name: "Legend",
    threshold: 2_000,
    color: "#E8B04B",
    badge: "legend",
    perks: [{ label: "Pinned badge" }],
  },
];

/** Default config for a new realm (rate is fixed: 1 USDC = 1 point, ADR 0007; tiers and minimums are configurable). */
export function defaultChannelConfig(channelId: string): ChannelConfig {
  return {
    channelId,
    version: 1,
    hash: `cfg-${channelId}-v1`,
    tiers: DEFAULT_TIERS,
    minDonation: toMicro(0.1),
    minDonationWithText: toMicro(0.5),
    minReputationToTask: 0, // §10: no threshold by default; the streamer raises it to anti-spam tasks
    minReputationToDispute: 1, // §10: the right to raise a dispute starts at 1 point (≈ 1 USDC crown), the streamer configures it
    messageMaxLen: 200,
    nameMode: "addresses_only",
    textShowMode: "manual",
    moderators: [],
    blockedWords: [], // owner-set banned words/symbols in crown text (empty = none)
    removeLinks: false, // spam filter: strip links from crown text (off = links pass through)
    enabledGames: [], // mini-games are disabled by default (cold-start; ADR 0016)
    updatedAt: new Date().toISOString(),
  };
}
