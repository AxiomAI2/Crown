"use client";

import { useState } from "react";
import { TierBadge } from "./standing";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeaderboard } from "@/lib/data/hooks";
import { cn, formatPoints, shortAddress } from "@/lib/utils";
import type { Address, LeaderboardPeriod } from "@/lib/data/types";

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "all_time", label: "За всё время" },
  { value: "month", label: "Месяц" },
  { value: "top_donor_month", label: "Топ месяца" },
];

export function Leaderboard({
  channelId,
  currentAddress,
}: {
  channelId: string;
  currentAddress?: Address | null;
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all_time");
  const { data, isLoading, error, refetch } = useLeaderboard(channelId, period);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
        <TabsList>
          {PERIODS.map((p) => (
            <TabsTrigger key={p.value} value={p.value}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description="Не удалось загрузить лидерборд." onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Пока пусто" description="Будь первым, кто наберёт standing на этом канале." />
      ) : (
        <ol className="flex flex-col gap-1">
          {data.map((e) => (
            <li
              key={e.donor}
              className={cn(
                "flex items-center justify-between rounded border border-border bg-surface px-3 py-2",
                e.donor === currentAddress && "border-status",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="mono w-6 text-small text-fg-faint">{e.rank}</span>
                <span className="text-small text-fg">{e.displayName ?? shortAddress(e.donor)}</span>
                <TierBadge tier={e.tier} />
              </div>
              <span className="mono text-small text-fg-muted">{formatPoints(e.points)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
