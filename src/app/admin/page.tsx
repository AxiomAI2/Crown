"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { CHANNEL_PLATFORMS, platformDef } from "@/lib/channel-links";
import {
  CumulativeAreaChart,
  DailyBars,
  RangeTabs,
  type ChartRange,
} from "@/components/domain/area-chart";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { GAMES } from "@/games/registry";
import type { EscrowTask } from "@/games/escrow-task/types";
import { splitAmount } from "@/lib/chain/addresses";
import { useData } from "@/lib/data/context";
import { useDiscovery } from "@/lib/data/hooks";
import type { ChannelConfig, ChannelLinkPlatform, Donation } from "@/lib/data/types";
import { cn, fromMicro } from "@/lib/utils";

const TASK_STATUS_LABEL: Record<EscrowTask["status"], string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  DONE: "Delivered",
  DISPUTED: "Disputed",
  RESOLVED: "Resolved",
};
const TASK_STATUS_ORDER: EscrowTask["status"][] = [
  "PENDING",
  "ACCEPTED",
  "DONE",
  "DISPUTED",
  "RESOLVED",
];

const DAY = 86_400_000;

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}
function usdNum(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
/** Compact format for axes: $1.2M / $34k / $560. */
function usdShort(micro: bigint): string {
  const n = fromMicro(micro);
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + Math.round(n);
}

/**
 * Admin → Dashboard. Metrics + charts across the whole platform.
 * Growth — accumulation of crowned/patrons over time (events from all realms' crowns; 0 before the first crown).
 * Below — distribution (bar charts) by platform and realm size.
 */
export default function AdminDashboardPage() {
  const provider = useData();
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);

  // Crowns across all realms → events for the growth charts (there is no global crown feed — we aggregate).
  const donationQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["donations", r.channelId] as const,
      queryFn: () => provider.listDonations(r.channelId),
      staleTime: 30_000,
    })),
  });
  const donationsLoading = donationQs.some((q) => q.isLoading);

  // Per-realm config (enabledGames → adoption) + escrow-tasks (status distribution). Same query keys as
  // useChannelConfig / useEscrowTasks → React Query dedupes. Moved here from /admin/games (the games page
  // is now the task HISTORY list); this dashboard owns the platform-wide game distribution charts.
  const configQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["channelConfig", r.channelId] as const,
      queryFn: () => provider.getChannelConfig(r.channelId),
      staleTime: 30_000,
    })),
  });
  const taskQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["game", "escrow-task", r.channelId] as const,
      queryFn: () =>
        provider.gameQuery({ gameId: "escrow-task", channelId: r.channelId, op: "list" }) as Promise<{
          tasks: EscrowTask[];
        }>,
      staleTime: 30_000,
    })),
  });
  const gamesLoading = configQs.some((q) => q.isLoading) || taskQs.some((q) => q.isLoading);

  const games = useMemo(() => {
    const configs = configQs.map((q) => q.data).filter(Boolean) as ChannelConfig[];
    const tasks = taskQs.flatMap((q) => q.data?.tasks ?? []);
    const adoption = GAMES.map((g) => ({
      key: g.id,
      label: g.title + (g.status === "building" ? " · in dev" : ""),
      value: configs.filter((c) => c.enabledGames?.includes(g.id)).length,
    }));
    const byStatus = TASK_STATUS_ORDER.map((st) => ({
      key: st,
      label: TASK_STATUS_LABEL[st],
      value: tasks.filter((t) => t.status === st).length,
    }));
    const resolved = tasks.filter((t) => t.resolution);
    return {
      adoption,
      byStatus,
      taskCount: tasks.length,
      toStreamer: resolved.filter((t) => t.resolution?.outcome === "to_streamer").length,
      toDonor: resolved.filter((t) => t.resolution?.outcome === "to_donor").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQs.map((q) => q.dataUpdatedAt).join(","), taskQs.map((q) => q.dataUpdatedAt).join(",")]);

  const { turnoverEvents, patronEvents, uniquePatrons } = useMemo(() => {
    const all: Donation[] = donationQs.flatMap((q) => q.data?.items ?? []);
    const turnover = all.map((d) => ({ t: Date.parse(d.ts), v: fromMicro(d.amount) }));
    // Patrons: the first appearance of each donor (v=1) → cumulative count of unique donors.
    const firstByDonor = new Map<string, number>();
    for (const d of all) {
      const t = Date.parse(d.ts);
      const prev = firstByDonor.get(d.donor);
      if (prev === undefined || t < prev) firstByDonor.set(d.donor, t);
    }
    const patrons = [...firstByDonor.values()].map((t) => ({ t, v: 1 }));
    // A zero point one day before launch → the line clearly starts from 0.
    if (turnover.length > 0) {
      const minT = Math.min(...turnover.map((e) => e.t));
      turnover.unshift({ t: minT - DAY, v: 0 });
    }
    if (patrons.length > 0) {
      const minT = Math.min(...patrons.map((e) => e.t));
      patrons.unshift({ t: minT - DAY, v: 0 });
    }
    // uniquePatrons — DISTINCT donors platform-wide (same source as the chart). NOT the sum of per-realm
    // donorsCount: a donor on N realms would otherwise be counted N times (that was the "102 vs 24" bug).
    return { turnoverEvents: turnover, patronEvents: patrons, uniquePatrons: firstByDonor.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donationQs.map((q) => q.dataUpdatedAt).join(",")]);

  const m = useMemo(() => {
    const totalCrowned = realms.reduce((s, r) => s + r.totalDonated, 0n);
    const crowned7d = realms.reduce((s, r) => s + (r.crowned7d ?? 0n), 0n);
    const active = realms.filter((r) => r.activated).length;
    const live = realms.filter((r) => r.isLive).length;
    const fees = splitAmount(totalCrowned).fee;
    const avg = realms.length ? totalCrowned / BigInt(realms.length) : 0n;
    const largest = realms.reduce((mx, r) => (r.totalDonated > mx ? r.totalDonated : mx), 0n);

    // Attribute each realm to its PRIMARY platform (first link) only — so a realm on N platforms isn't
    // summed N times (that tripled a 3-link realm's volume). This makes the bars a partition, not overlaps.
    const byPlatform = CHANNEL_PLATFORMS.map((p) => {
      const rs = realms.filter((r) => (r.links ?? [])[0]?.platform === p.key);
      return {
        key: p.key as ChannelLinkPlatform,
        label: p.label,
        count: rs.length,
        crowned: rs.reduce((s, r) => s + r.totalDonated, 0n),
      };
    })
      .filter((x) => x.count > 0)
      .sort((a, b) => (b.crowned > a.crowned ? 1 : b.crowned < a.crowned ? -1 : 0));

    const BUCKETS: { label: string; test: (n: number) => boolean }[] = [
      { label: "< $1k", test: (n) => n < 1_000 },
      { label: "$1k–10k", test: (n) => n >= 1_000 && n < 10_000 },
      { label: "$10k–100k", test: (n) => n >= 10_000 && n < 100_000 },
      { label: "$100k+", test: (n) => n >= 100_000 },
    ];
    const sizeBuckets = BUCKETS.map((b) => ({
      label: b.label,
      count: realms.filter((r) => b.test(fromMicro(r.totalDonated))).length,
    }));

    return { totalCrowned, crowned7d, active, live, fees, avg, largest, byPlatform, sizeBuckets };
  }, [realms]);

  const [range, setRange] = useState<ChartRange>("ALL");
  const [view, setView] = useState<"chart" | "bars">("chart");

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (error) return <ErrorState description="Couldn't load platform data." onRetry={() => refetch()} />;

  // Both take the same set of props (events/range/formatValue/color/emptyHint) → we pick the component.
  const GrowthChart = view === "bars" ? DailyBars : CumulativeAreaChart;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-fg">Dashboard</h1>
        <p className="text-small text-fg-faint">Platform overview across all realms.</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Realms" value={String(realms.length)} sub={`${m.active} active · ${m.live} live`} />
        <StatCard label="Total crowned" value={usd(m.totalCrowned)} tone="money" />
        <StatCard label="Last 7 days" value={usd(m.crowned7d)} tone="money" />
        <StatCard label="Platform fees" value={usd(m.fees)} sub="3% of volume" tone="money" />
        <StatCard
          label="Supporters"
          value={donationsLoading ? "…" : uniquePatrons.toLocaleString("en-US")}
          sub="unique across realms"
        />
        <StatCard label="Avg / realm" value={usd(m.avg)} />
        <StatCard label="Largest realm" value={usd(m.largest)} />
        <StatCard label="Live now" value={String(m.live)} sub={`of ${realms.length}`} />
      </div>

      {/* Growth over time */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-h3 text-fg">Growth</h2>
            <p className="text-caption text-fg-faint">
              {view === "bars" ? "Per day · 0 on empty days" : "Cumulative · 0 before launch"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <RangeTabs range={range} onChange={setRange} />
          </div>
        </div>
        {donationsLoading ? (
          <Skeleton className="h-40 w-full rounded" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">
                {view === "bars" ? "Crowned / day" : "Total crowned"}
              </span>
              <GrowthChart
                events={turnoverEvents}
                range={range}
                formatValue={usdNum}
                emptyHint="Crowned appears after the first donation."
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">
                {view === "bars" ? "New supporters / day" : "Supporters"}
              </span>
              <GrowthChart
                events={patronEvents}
                range={range}
                color="var(--info)"
                formatValue={(v) => Math.round(v).toLocaleString("en-US")}
                emptyHint="Supporters appear after the first donation."
              />
            </div>
          </div>
        )}
      </section>

      {/* Distribution (bar charts) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Crowned by platform" hint="Where volume concentrates">
          <BarList
            rows={m.byPlatform.map((p) => ({
              key: p.key,
              label: p.label,
              value: fromMicro(p.crowned),
              display: usdShort(p.crowned),
              iconPath: platformDef(p.key)?.iconPath,
            }))}
          />
        </ChartCard>
        <ChartCard title="Realms by size" hint="Distribution of realm crowned totals">
          <BarList
            tone="count"
            rows={m.sizeBuckets.map((b) => ({
              key: b.label,
              label: b.label,
              value: b.count,
              display: String(b.count),
            }))}
          />
        </ChartCard>
      </div>

      {/* Mini-games distribution — moved here from /admin/games (that page is now the task history list). */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Adoption by game" hint="How many realms have each game turned on">
          {gamesLoading ? (
            <Skeleton className="h-24 w-full rounded" />
          ) : (
            <BarList
              tone="count"
              rows={games.adoption.map((a) => ({
                key: a.key,
                label: a.label,
                value: a.value,
                display: String(a.value),
              }))}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Escrow tasks by status"
          hint={
            games.taskCount > 0
              ? `${games.toStreamer} paid to streamer · ${games.toDonor} refunded to supporter`
              : "No escrow tasks yet — streamers enable games per realm."
          }
        >
          {gamesLoading ? (
            <Skeleton className="h-24 w-full rounded" />
          ) : (
            <BarList
              tone="count"
              rows={games.byStatus.map((s) => ({
                key: s.key,
                label: s.label,
                value: s.value,
                display: String(s.value),
              }))}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: "chart" | "bars";
  onChange: (v: "chart" | "bars") => void;
}) {
  const opts: { k: "chart" | "bars"; label: string }[] = [
    { k: "chart", label: "Chart" },
    { k: "bars", label: "Bars" },
  ];
  return (
    <div
      role="group"
      aria-label="Chart view"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-[var(--bg)] p-0.5"
    >
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          aria-pressed={value === o.k}
          className={cn(
            "rounded-md px-2.5 py-1 text-small font-medium transition-colors",
            value === o.k
              ? "bg-surface-raised text-fg shadow-sm"
              : "text-fg-faint hover:bg-surface-raised/60 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "money";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-caption text-fg-faint">{label}</span>
      <span className={cn("font-display text-xl font-semibold", tone === "money" ? "text-money" : "text-fg")}>
        {value}
      </span>
      {sub ? <span className="text-caption text-fg-faint">{sub}</span> : null}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-h3 text-fg">{title}</h2>
        {hint ? <p className="text-caption text-fg-faint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Simple horizontal bar chart (no external libs): bar width is proportional to max.
 *  `money` bars are gold (a $ magnitude); `count` bars are neutral — gold is rationed for money, not tallies. */
function BarList({
  rows,
  tone = "money",
}: {
  rows: { key: string; label: string; value: number; display: string; iconPath?: string }[];
  tone?: "money" | "count";
}) {
  if (rows.length === 0) return <p className="text-small text-fg-faint">No data.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const barCls = tone === "money" ? "bg-money" : "bg-fg-faint";
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="flex w-24 flex-none items-center gap-1.5 text-small text-fg-muted">
            {r.iconPath ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 flex-none overflow-visible" aria-hidden="true">
                <path d={r.iconPath} />
              </svg>
            ) : null}
            <span className="truncate">{r.label}</span>
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-pill bg-[var(--bg)]">
            <div className={cn("h-full rounded-pill", barCls)} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="mono w-14 flex-none text-right text-small text-fg">{r.display}</span>
        </div>
      ))}
    </div>
  );
}
