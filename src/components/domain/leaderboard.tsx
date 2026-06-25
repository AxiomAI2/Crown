"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TierBadge } from "./standing";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeaderboard } from "@/lib/data/hooks";
import { cn, formatPoints, shortAddress } from "@/lib/utils";
import type { Address, LeaderboardEntry, LeaderboardPeriod } from "@/lib/data/types";

// «Топ месяца» (top_donor_month) убран: он показывал лишь донатера №1 за месяц — это и есть верх вкладки
// «Месяц», т.е. дубль. Сам период в типе остаётся (его использует оверлей), но отдельной вкладки нет.
const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "all_time", label: "За всё время" },
  { value: "month", label: "Месяц" },
];

type SortKey = "points" | "total" | "tier";

function sortEntries(entries: LeaderboardEntry[], sort: SortKey): LeaderboardEntry[] {
  const arr = [...entries];
  if (sort === "total") arr.sort((a, b) => Number(b.totalDonated - a.totalDonated));
  else if (sort === "tier")
    arr.sort((a, b) => b.tier.threshold - a.tier.threshold || b.points - a.points);
  // "points" — сервер уже отдаёт по очкам (это и есть ранг), не пересортировываем.
  return arr;
}

/**
 * Список донатеров канала: ранжирование по периоду (всё время / месяц) + сортировка (standing / сумма /
 * тир). Каждая строка — ссылка на публичный профиль донатера (/u/[address]). Номер = позиция в текущей сортировке.
 */
export function Leaderboard({
  channelId,
  currentAddress,
}: {
  channelId: string;
  currentAddress?: Address | null;
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all_time");
  const [sort, setSort] = useState<SortKey>("points");
  const { data, isLoading, error, refetch } = useLeaderboard(channelId, period);
  const rows = useMemo(() => sortEntries(data ?? [], sort), [data, sort]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
          <TabsList>
            {PERIODS.map((p) => (
              <TabsTrigger key={p.value} value={p.value}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-44"
        >
          <option value="points">По standing</option>
          <option value="total">По сумме</option>
          <option value="tier">По тиру</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description="Не удалось загрузить лидерборд." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Пока пусто" description="Будь первым, кто наберёт standing на этом канале." />
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((e, i) => (
            <li key={e.donor}>
              <Link
                href={`/u/${e.donor}`}
                className={cn(
                  "flex items-center justify-between rounded border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong",
                  e.donor === currentAddress && "border-status",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mono w-6 shrink-0 text-small text-fg-faint">{i + 1}</span>
                  <span className="truncate text-small text-fg">
                    {e.displayName ?? shortAddress(e.donor)}
                  </span>
                  <TierBadge tier={e.tier} />
                </div>
                <span className="mono shrink-0 text-small text-fg-muted">{formatPoints(e.points)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
