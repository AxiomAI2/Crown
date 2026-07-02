"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "./context";
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
  donorOverview: (address: Address) => ["donorOverview", address] as const,
  homeFeed: (address: string) => ["homeFeed", address] as const,
  moderationQueue: (channelId: string) => ["moderation", channelId] as const,
  blocklist: (channelId: string) => ["blocklist", channelId] as const,
  operatorQueue: () => ["operatorQueue"] as const,
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
/** Лента главной (ADR 0018). Личность сервер берёт из сессии; адрес — только для ключа кэша (рефетч при смене). */
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
/** Донор: мой блок на этом канале (+причина) — для плашки в карточке доната. Ключ скоупим адресом. */
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
 * «Требует внимания»: сколько сообщений ждёт решения (HELD) во ВСЕХ каналах, которыми управляешь (владелец/
 * модератор). Делит тот же кэш, что и useModerationQueue. Для синей точки-уведомления в навигации.
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

// — Мутации —
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
      // В chain-режиме зачёт репутации приходит на finalized (~15-30с) В ФОНЕ (см. ChainDataProvider) —
      // поэтому довыпрашиваем данные ещё несколько раз после доната, чтобы очки/лента появились без ручного
      // refresh. Для mock/api зачёт мгновенный → лишние рефетчи безвредны (та же выдача).
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
      qc.invalidateQueries({ queryKey: qk.donations(channelId) }); // авто-скрытие могло изменить ленту
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
/** H1: закрепить payout-адрес канала подписью кошелька владельца (chain-провайдер подписывает сам). */
export function useAttestPayout() {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => data.attestPayout(channelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel"] }); // страница канала видит аттестацию → донат открывается
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
      qc.invalidateQueries({ queryKey: qk.discovery() }); // статус канала мог измениться (suspend/restore)
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

// — Dev/сессия-контролы: установка адреса личности (кошелёк под chain; dev-ввод под api/mock) —
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
      // Смена личности (вход/выход) в dev — выкидываем кэш сразу, чтобы данные прошлой личности не висели
      // до рефетча (тот же принцип, что в ChainWalletBridge для реального кошелька).
      qc.clear();
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
