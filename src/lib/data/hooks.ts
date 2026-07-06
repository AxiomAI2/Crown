"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "./context";
import type { DisputeParamsValues } from "../chain/dispute-params";
import type {
  Address,
  ConfigPatch,
  CreateChannelInput,
  DonationInput,
  LeaderboardPeriod,
  LightProfile,
  OperatorAction,
} from "./types";

/** Stable cache keys (yellow-paper §11). */
export const qk = {
  session: () => ["session"] as const,
  discovery: () => ["discovery"] as const,
  channel: (handle: string) => ["channel", handle] as const,
  myChannel: () => ["myChannel"] as const,
  channelConfig: (channelId: string) => ["channelConfig", channelId] as const,
  standing: (channelId: string, address: Address) => ["standing", channelId, address] as const,
  leaderboard: (channelId: string, period: LeaderboardPeriod) =>
    ["leaderboard", channelId, period] as const,
  donations: (channelId: string) => ["donations", channelId] as const,
  donorOverview: (address: Address) => ["donorOverview", address] as const,
  homeFeed: (address: string) => ["homeFeed", address] as const,
  moderationQueue: (channelId: string) => ["moderation", channelId] as const,
  blocklist: (channelId: string) => ["blocklist", channelId] as const,
  operatorQueue: () => ["operatorQueue"] as const,
  profile: (address: Address) => ["profile", address] as const,
};

// — Queries —
export function useSession() {
  const data = useData();
  return useQuery({ queryKey: qk.session(), queryFn: () => data.getSession() });
}
export function useDiscovery() {
  const data = useData();
  return useQuery({ queryKey: qk.discovery(), queryFn: () => data.listChannels() });
}
export function useChannel(handle: string) {
  const data = useData();
  return useQuery({ queryKey: qk.channel(handle), queryFn: () => data.getChannel(handle) });
}
export function useMyChannel() {
  const data = useData();
  return useQuery({ queryKey: qk.myChannel(), queryFn: () => data.getMyChannel() });
}
export function useManagedChannels() {
  const data = useData();
  return useQuery({ queryKey: ["managedChannels"], queryFn: () => data.getManagedChannels() });
}
export function useOperatorChannels() {
  const data = useData();
  return useQuery({ queryKey: ["operatorChannels"], queryFn: () => data.getOperatorChannels() });
}
export function useChannelConfig(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.channelConfig(channelId ?? ""),
    queryFn: () => data.getChannelConfig(channelId!),
    enabled: Boolean(channelId),
  });
}
export function useStanding(channelId: string | undefined, address: Address | null | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.standing(channelId ?? "", address ?? ""),
    queryFn: () => data.getStanding(channelId!, address!),
    enabled: Boolean(channelId && address),
  });
}
export function useLeaderboard(channelId: string | undefined, period: LeaderboardPeriod) {
  const data = useData();
  return useQuery({
    queryKey: qk.leaderboard(channelId ?? "", period),
    queryFn: () => data.getLeaderboard(channelId!, period),
    enabled: Boolean(channelId),
  });
}
export function useDonations(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.donations(channelId ?? ""),
    queryFn: () => data.listDonations(channelId!),
    enabled: Boolean(channelId),
  });
}
export function useDonorOverview(address: Address | null | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.donorOverview(address ?? ""),
    queryFn: () => data.getDonorOverview(address!),
    enabled: Boolean(address),
  });
}
/** Home feed (ADR 0018). The server takes identity from the session; the address is only for the cache key (refetch on change). */
export function useHomeFeed() {
  const data = useData();
  const address = useSession().data?.address ?? null;
  return useQuery({
    queryKey: qk.homeFeed(address ?? ""),
    queryFn: () => data.homeFeed(),
  });
}
export function useModerationQueue(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.moderationQueue(channelId ?? ""),
    queryFn: () => data.getModerationQueue(channelId!),
    enabled: Boolean(channelId),
  });
}
export function useChannelBlocklist(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.blocklist(channelId ?? ""),
    queryFn: () => data.getChannelBlocklist(channelId!),
    enabled: Boolean(channelId),
  });
}
/** Supporter: my block on this realm (+reason) — for the banner in the crown card. We scope the key by address. */
export function useMyBlock(channelId: string | undefined, address: Address | null | undefined) {
  const data = useData();
  return useQuery({
    queryKey: ["myBlock", channelId ?? "", address ?? ""],
    queryFn: () => data.getMyChannelBlock(channelId!),
    enabled: Boolean(channelId && address),
  });
}
export function useOperatorQueue() {
  const data = useData();
  return useQuery({ queryKey: qk.operatorQueue(), queryFn: () => data.getOperatorQueue() });
}

/**
 * "Needs attention": how many messages are awaiting a decision (HELD) across ALL realms you manage (owner/
 * moderator). Shares the same cache as useModerationQueue. For the blue notification dot in the nav.
 */
export function useModerationAttention() {
  const data = useData();
  const managed = useManagedChannels();
  const channels = managed.data ?? [];
  const results = useQueries({
    queries: channels.map((c) => ({
      queryKey: qk.moderationQueue(c.id),
      queryFn: () => data.getModerationQueue(c.id),
    })),
  });
  const pending = results.reduce((n, r) => n + (r.data?.length ?? 0), 0);
  return { pending, hasPending: pending > 0 };
}
export function useProfile(address: Address | null | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.profile(address ?? ""),
    queryFn: () => data.getProfile(address!),
    enabled: Boolean(address),
  });
}

// — Mutations —
export function useDonate(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DonationInput, "channelId">) =>
      data.createDonation({ ...input, channelId }),
    onSuccess: () => {
      const invalidate = () => {
        qc.invalidateQueries({ queryKey: ["standing", channelId] });
        qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
        qc.invalidateQueries({ queryKey: qk.donations(channelId) });
        qc.invalidateQueries({ queryKey: qk.moderationQueue(channelId) });
      };
      invalidate();
      // In chain mode the Reign credit arrives on finalized (~15-30s) IN THE BACKGROUND (see ChainDataProvider) —
      // so we re-fetch the data a few more times after the crown, so points/feed appear without a manual
      // refresh. For mock/api the credit is instant → the extra refetches are harmless (same result).
      [8000, 18000, 30000].forEach((ms) => setTimeout(invalidate, ms));
    },
  });
}
export function useSetMessageState(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, state }: { messageId: string; state: "SHOWN" | "HIDDEN" }) =>
      data.setMessageState(messageId, state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.moderationQueue(channelId) });
      qc.invalidateQueries({ queryKey: qk.donations(channelId) });
    },
  });
}
export function useHideDonorMessages(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (donor: Address) => data.hideDonorMessages(channelId, donor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.moderationQueue(channelId) });
      qc.invalidateQueries({ queryKey: qk.donations(channelId) });
    },
  });
}
export function useReportMessage(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, reason }: { messageId: string; reason?: string }) =>
      data.reportMessage(messageId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.donations(channelId) }); // auto-hiding may have changed the feed
      qc.invalidateQueries({ queryKey: qk.moderationQueue(channelId) });
      qc.invalidateQueries({ queryKey: qk.operatorQueue() });
    },
  });
}
export function useUpdateConfig(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ConfigPatch) => data.updateChannelConfig(channelId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.channelConfig(channelId) });
      qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
      qc.invalidateQueries({ queryKey: ["standing", channelId] });
    },
  });
}
export function useActivateChannel() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => data.activateChannel(channelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel"] });
      qc.invalidateQueries({ queryKey: qk.myChannel() });
      qc.invalidateQueries({ queryKey: qk.discovery() });
    },
  });
}
/** H1: pin the realm's payout address with the owner's wallet signature (the chain provider signs itself). */
export function useAttestPayout() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => data.attestPayout(channelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel"] }); // the realm page sees the attestation → crowning opens up
      qc.invalidateQueries({ queryKey: qk.myChannel() });
    },
  });
}
export function useCreateChannel() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => data.createChannel(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.session() });
      qc.invalidateQueries({ queryKey: qk.myChannel() });
      qc.invalidateQueries({ queryKey: ["channel"] });
      qc.invalidateQueries({ queryKey: qk.discovery() });
    },
  });
}
export function useAddBlock(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ address, reason }: { address: Address; reason?: string }) =>
      data.addChannelBlock(channelId, address, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.blocklist(channelId) }),
  });
}
export function useRemoveBlock(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: Address) => data.removeChannelBlock(channelId, address),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.blocklist(channelId) }),
  });
}
export function useApplyOperatorAction() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: Omit<OperatorAction, "id" | "ts" | "byOperator">) =>
      data.applyOperatorAction(action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.operatorQueue() });
      qc.invalidateQueries({ queryKey: ["channel"] });
      qc.invalidateQueries({ queryKey: ["standing"] });
      qc.invalidateQueries({ queryKey: qk.discovery() }); // the realm status may have changed (suspend/restore)
      qc.invalidateQueries({ queryKey: ["operatorChannels"] });
      qc.invalidateQueries({ queryKey: qk.myChannel() });
    },
  });
}
export function useUpdateProfile() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<LightProfile>) => data.updateProfile(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: qk.session() });
    },
  });
}

// — Dev/session controls: setting the identity address (wallet under chain; dev input under api/mock) —
interface SessionControls {
  __setAddress(address: Address | null): void;
  __getAddress(): Address | null;
  __setFailMode(on: boolean): void;
  __getFailMode(): boolean;
  __setLatencyScale(scale: number): void;
  __reset(): void;
}

function asDev(provider: unknown): SessionControls | null {
  if (provider && typeof (provider as SessionControls).__setAddress === "function") {
    return provider as SessionControls;
  }
  return null;
}

export function useDevControls() {
  const data = useData();
  const qc = useQueryClient();
  const dev = asDev(data);
  return {
    available: dev !== null,
    address: dev?.__getAddress() ?? null,
    failMode: dev?.__getFailMode() ?? false,
    setAddress: (address: Address | null) => {
      dev?.__setAddress(address);
      // Switching identity (sign in/out) in dev — INVALIDATE, not qc.clear(): in TanStack v5 clear() removes
      // queries without refetching active observers, so mounted screens freeze on skeletons forever
      // (same rule as ChainWalletBridge, wallet-provider.tsx). invalidate refetches everything in background.
      void qc.invalidateQueries();
    },
    setFailMode: (on: boolean) => {
      dev?.__setFailMode(on);
      qc.invalidateQueries();
    },
    setLatencyScale: (scale: number) => dev?.__setLatencyScale(scale),
    reset: () => {
      dev?.__reset();
      qc.invalidateQueries();
    },
  };
}

// ─────────── dispute governance params (migration M1, ADR 0021; icp mode only) ───────────

/** A realm's dispute params from the canister. Other providers don't have the method → the hook is disabled. */
export function useDisputeParams(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: ["dispute-params", channelId ?? ""],
    queryFn: () => data.getDisputeParams!(channelId!),
    enabled: Boolean(channelId && data.getDisputeParams),
  });
}

/** Write dispute params: the owner's wallet signature → the canister (timelock §8.9). */
export function useSetDisputeParams() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; params: DisputeParamsValues }) =>
      data.setDisputeParams!(input.channelId, input.params),
    onSuccess: (_res, input) => {
      qc.invalidateQueries({ queryKey: ["dispute-params", input.channelId] });
    },
  });
}
