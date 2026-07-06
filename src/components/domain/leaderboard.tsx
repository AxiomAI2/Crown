"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Monogram } from "./header-actions";
import { TierBadge } from "./standing";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeaderboard } from "@/lib/data/hooks";
import type { Address, LeaderboardEntry, LeaderboardPeriod, Tier } from "@/lib/data/types";
import { cn, formatPoints, shortAddress } from "@/lib/utils";

// "Top of the month" (top_donor_month) was removed as a duplicate of the "Month" top. The period stays in the type (the overlay uses it).
const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "all_time", label: "All time" },
  { value: "month", label: "Month" },
];

type SortKey = "points" | "total";

function sortEntries(entries: LeaderboardEntry[], sort: SortKey): LeaderboardEntry[] {
  const arr = [...entries];
  if (sort === "total") arr.sort((a, b) => Number(b.totalDonated - a.totalDonated));
  // "points" — the server already returns by points (that is the rank), so we don't re-sort.
  return arr;
}

/**
 * Realm supporters: period (all time / month) + sorting (standing / amount) + FILTER by tier (show
 * only supporters of a specific local tier). Each row is a link to a profile (/u/[address]).
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
  const [tierFilter, setTierFilter] = useState<string>("all"); // tier name or "all"
  const { data, isLoading, error, refetch } = useLeaderboard(channelId, period);

  // Tiers actually present among supporters (for the filter), in ascending threshold order.
  const tiers = useMemo(() => {
    const byName = new Map<string, Tier>();
    for (const e of data ?? []) if (e.tier) byName.set(e.tier.name, e.tier);
    return [...byName.values()].sort((a, b) => a.threshold - b.threshold);
  }, [data]);

  const rows = useMemo(() => {
    const filtered = (data ?? []).filter((e) => tierFilter === "all" || e.tier?.name === tierFilter);
    return sortEntries(filtered, sort);
  }, [data, sort, tierFilter]);

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
        <div className="flex items-center gap-2">
          <Select
            aria-label="Filter by tier"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="w-40"
          >
            <option value="all">All tiers</option>
            {tiers.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-40"
          >
            <option value="points">By Reign</option>
            <option value="total">By amount</option>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description="Couldn't load the leaderboard." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Empty"
          description={
            tierFilter === "all"
              ? "Be the first to build Reign on this realm."
              : "No supporters in this tier."
          }
        />
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
                  <Monogram name={e.displayName ?? e.donor} avatarUrl={e.avatarUrl} size="sm" />
                  <span className="truncate text-small text-fg">
                    {e.displayName ?? shortAddress(e.donor)}
                  </span>
                  {e.tier ? <TierBadge tier={e.tier} /> : null}
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
