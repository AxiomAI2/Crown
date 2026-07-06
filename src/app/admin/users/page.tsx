"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useData } from "@/lib/data/context";
import { useDiscovery } from "@/lib/data/hooks";
import type { LeaderboardEntry } from "@/lib/data/types";
import { cn, fromMicro, shortAddress } from "@/lib/utils";

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}
function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

type UserSort = "crowned" | "reign" | "realms";
interface AggUser {
  address: string;
  name?: string;
  crowned: bigint;
  reign: number;
  realms: number;
}

/**
 * Admin → Users. There's no global user list in the core (Reign is local), so we collect supporters from
 * the leaderboards of ALL realms (getLeaderboard for each) and aggregate: total crowned, Reign, number of realms.
 * N requests for N realms — fine for an admin/dev tool; at large scale a server-side aggregate goes here.
 */
export default function AdminUsersPage() {
  const provider = useData();
  const { data: disc, isLoading: realmsLoading, error: realmsError, refetch } = useDiscovery();
  const realms = useMemo(() => disc?.items ?? [], [disc]);

  const boards = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["leaderboard", r.channelId, "all_time"] as const,
      queryFn: () => provider.getLeaderboard(r.channelId, "all_time"),
      staleTime: 30_000,
    })),
  });

  const loading = realmsLoading || boards.some((b) => b.isLoading);
  const boardsError = boards.some((b) => b.isError);

  // Aggregation is cheap (demo scale) — we compute it on every render from fresh leaderboard data.
  const users: AggUser[] = [];
  {
    const map = new Map<string, AggUser>();
    for (const b of boards) {
      for (const e of (b.data ?? []) as LeaderboardEntry[]) {
        const u = map.get(e.donor) ?? { address: e.donor, crowned: 0n, reign: 0, realms: 0 };
        u.crowned += e.totalDonated;
        // Reign is PER-realm (invariant §4.3) — it is NOT summable across realms (summing just re-derived
        // Crowned, since 1 USDC = 1 Reign, so the column duplicated Crowned). Show the donor's BEST single-realm
        // standing instead — a real, meaningful number.
        u.reign = Math.max(u.reign, e.points);
        u.realms += 1;
        if (!u.name && e.displayName) u.name = e.displayName;
        map.set(e.donor, u);
      }
    }
    users.push(...map.values());
  }

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UserSort>("crowned");
  const q = query.trim().toLowerCase();
  const visible = users
    .filter((u) => !q || `${u.address} ${u.name ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === "reign") return b.reign - a.reign;
      if (sort === "realms") return b.realms - a.realms || (b.crowned > a.crowned ? 1 : -1);
      return b.crowned > a.crowned ? 1 : b.crowned < a.crowned ? -1 : 0;
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-fg">Users</h1>
          <p className="text-small text-fg-faint">
            {users.length} total
            {visible.length !== users.length ? ` · ${visible.length} shown` : ""}
          </p>
        </div>
        {users.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <UserSortToggle value={sort} onChange={setSort} />
            <ExpandingSearch
              value={query}
              onChange={setQuery}
              placeholder="Search users…"
              label="Search users"
            />
          </div>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : realmsError || boardsError ? (
        <ErrorState description="Couldn't load users." onRetry={() => refetch()} />
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" description="Patrons appear once realms receive crowns." />
      ) : visible.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-caption uppercase tracking-wide text-fg-faint">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">User</th>
                <th className="px-4 py-2.5 text-right font-medium">Crowned</th>
                <th className="px-4 py-2.5 text-right font-medium">Reign</th>
                <th className="px-4 py-2.5 text-right font-medium">Realms</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u, i) => (
                <tr key={u.address} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-fg-faint">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/u/${u.address}`} className="flex flex-col transition-colors hover:text-status">
                      {u.name ? <span className="text-fg">{u.name}</span> : null}
                      <span className="mono text-caption text-fg-faint">{shortAddress(u.address)}</span>
                    </Link>
                  </td>
                  <td className="mono px-4 py-2.5 text-right text-money">{usd(u.crowned)}</td>
                  <td className="mono px-4 py-2.5 text-right text-status">{num(u.reign)}</td>
                  <td className="px-4 py-2.5 text-right text-fg-muted">{u.realms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserSortToggle({ value, onChange }: { value: UserSort; onChange: (v: UserSort) => void }) {
  const opts: { k: UserSort; label: string }[] = [
    { k: "crowned", label: "Crowned" },
    { k: "reign", label: "Reign" },
    { k: "realms", label: "Realms" },
  ];
  return (
    <div
      role="group"
      aria-label="Sort users"
      className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5"
    >
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          aria-pressed={value === o.k}
          className={cn(
            "rounded-md px-3 py-1 text-small transition-colors",
            value === o.k ? "bg-money-bg text-money" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
