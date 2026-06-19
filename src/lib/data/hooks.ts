"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "./context";
import type { IdentityKey } from "./fixtures";
import type {
  Address,
  ConfigPatch,
  CreateChannelInput,
  DonationInput,
  LeaderboardPeriod,
  LightProfile,
  OperatorAction,
} from "./types";

/** Стабильные ключи кэша (mock-data.md §2). */
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
  moderationQueue: (channelId: string) => ["moderation", channelId] as const,
  blocklist: (channelId: string) => ["blocklist", channelId] as const,
  operatorQueue: () => ["operatorQueue"] as const,
  incidentLog: () => ["incidentLog"] as const,
  profile: (address: Address) => ["profile", address] as const,
};

// — Запросы —
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
export function useOperatorQueue() {
  const data = useData();
  return useQuery({ queryKey: qk.operatorQueue(), queryFn: () => data.getOperatorQueue() });
}
export function useIncidentLog() {
  const data = useData();
  return useQuery({ queryKey: qk.incidentLog(), queryFn: () => data.getIncidentLog() });
}
export function useProfile(address: Address | null | undefined) {
  const data = useData();
  return useQuery({
    queryKey: qk.profile(address ?? ""),
    queryFn: () => data.getProfile(address!),
    enabled: Boolean(address),
  });
}

// — Мутации —
export function useConnect() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => data.connect(),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useDisconnect() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => data.disconnect(),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useDonate(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DonationInput, "channelId">) =>
      data.createDonation({ ...input, channelId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["standing", channelId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
      qc.invalidateQueries({ queryKey: qk.donations(channelId) });
      qc.invalidateQueries({ queryKey: qk.moderationQueue(channelId) });
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
      qc.invalidateQueries({ queryKey: qk.incidentLog() });
      qc.invalidateQueries({ queryKey: ["channel"] });
      qc.invalidateQueries({ queryKey: ["standing"] });
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

// — Dev-контролы (только мок; api/chain их не имеют) —
interface MockDevControls {
  __setIdentity(key: IdentityKey): void;
  __getIdentityKey(): IdentityKey;
  __setFailMode(on: boolean): void;
  __getFailMode(): boolean;
  __setLatencyScale(scale: number): void;
  __reset(): void;
}

function asDev(provider: unknown): MockDevControls | null {
  if (provider && typeof (provider as MockDevControls).__setIdentity === "function") {
    return provider as MockDevControls;
  }
  return null;
}

export function useDevControls() {
  const data = useData();
  const qc = useQueryClient();
  const dev = asDev(data);
  return {
    available: dev !== null,
    identityKey: dev?.__getIdentityKey() ?? ("guest" as IdentityKey),
    failMode: dev?.__getFailMode() ?? false,
    setIdentity: (key: IdentityKey) => {
      dev?.__setIdentity(key);
      qc.invalidateQueries();
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
