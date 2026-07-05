"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "@/lib/data/context";
import type { EscrowTask, TaskResolution, TaskVote, VoteChoice } from "./types";

export interface DisputeVotesQuery {
  page?: number;
  pageSize?: number;
  side?: VoteChoice | null;
  sort?: "weight" | "recent";
  q?: string;
}

export interface DisputeVotesResult {
  found: boolean;
  task?: {
    id: string;
    status: EscrowTask["status"];
    amount: string;
    text: string;
    donor: string;
    resolution: TaskResolution | null;
  };
  dispute?: {
    by: string;
    openedAt: string;
    votingEndsAt: string;
    quorum: number;
    tally: {
      completed: number;
      not: number;
      completedVotes: number;
      notVotes: number;
      total: number;
    };
  };
  votes: TaskVote[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Типизированные хуки модуля «задание-донат» поверх обобщённого game-bus (ADR 0016). Только тут восстановлена
 * типобезопасность операций игры — экраны зовут эти хуки, а не сырые `gameAction`/`gameQuery`.
 */
const KEY = (channelId: string) => ["game", "escrow-task", channelId] as const;

export function useEscrowTasks(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: KEY(channelId ?? ""),
    queryFn: () =>
      data.gameQuery({ gameId: "escrow-task", channelId: channelId!, op: "list" }) as Promise<{
        tasks: EscrowTask[];
      }>,
    enabled: !!channelId,
  });
}

export function useEscrowAction(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { op: string; payload?: unknown }) =>
      data.gameAction({ gameId: "escrow-task", channelId, op: args.op, payload: args.payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(channelId) });
      // claim/исход меняют репутацию на канале → освежим standing и лидерборд.
      qc.invalidateQueries({ queryKey: ["standing", channelId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
    },
  });
}

/** Постраничные голоса спора (для страницы спора): фильтр по стороне, поиск по адресу, сортировка. */
export function useDisputeVotes(
  channelId: string | undefined,
  taskId: string | undefined,
  opts: DisputeVotesQuery,
) {
  const data = useData();
  return useQuery({
    queryKey: ["game", "escrow-task", channelId ?? "", "dispute", taskId ?? "", opts],
    queryFn: () =>
      data.gameQuery({
        gameId: "escrow-task",
        channelId: channelId!,
        op: "disputeVotes",
        payload: { taskId, ...opts },
      }) as Promise<DisputeVotesResult>,
    enabled: !!channelId && !!taskId,
  });
}

/**
 * Спор по chain-задаче ИЗ КАНИСТРЫ (M2, ADR 0021): открытое табло, голоса, вердикт,
 * ончейн-подписи резолвера. Метод есть только у IcpDataProvider — вне icp-режима хук выключен.
 * Поллинг: финализация и ончейн-отправки приходят таймером канистры (~20 с).
 */
export function useCanisterDispute(
  channelId: string | undefined,
  taskId: string | undefined,
  escrowTaskId: string | undefined,
) {
  const data = useData();
  return useQuery({
    queryKey: ["game", "escrow-task", channelId ?? "", "canister-dispute", taskId ?? ""],
    queryFn: () => data.getCanisterDispute!(channelId!, taskId!),
    enabled: Boolean(channelId && taskId && escrowTaskId && data.getCanisterDispute),
    refetchInterval: 15_000,
  });
}
