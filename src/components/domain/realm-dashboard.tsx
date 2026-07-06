"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Amount } from "@/components/domain/amount";
import { CumulativeAreaChart, DailyBars, RangeTabs, type ChartRange } from "@/components/domain/area-chart";
import { CreateChannelForm } from "@/components/domain/create-channel-form";
import { DonationHistory } from "@/components/domain/donation-history";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  useChannelConfig,
  useDonations,
  useLeaderboard,
  useModerationAttention,
  useMyChannel,
  useSession,
} from "@/lib/data/hooks";
import type { LeaderboardEntry } from "@/lib/data/types";
import { cn, formatUSDCNumber as usd, fromMicro, plural, shortAddress } from "@/lib/utils";

const DONORS = ["patron", "patrons", "patrons"] as const;
const DAY = 86_400_000;

/** "$12,480" from micro-USDC (bigint). */
function money(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}
function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Overview of YOUR realm (owner side): status, KPIs, analytics (turnover/patrons, Chart/Bars),
 * The Crown (top patrons), tier distribution, crown feed with moderation. No realm → creation form.
 */
export function RealmDashboard() {
  const sessionQ = useSession();
  const myChannelQ = useMyChannel();
  const channel = myChannelQ.data;
  const donationsQ = useDonations(channel?.id);
  const configQ = useChannelConfig(channel?.id);
  const boardQ = useLeaderboard(channel?.id, "all_time");
  const { pending } = useModerationAttention();

  const [range, setRange] = useState<ChartRange>("ALL");
  const [view, setView] = useState<"chart" | "bars">("chart");

  const donations = useMemo(() => donationsQ.data?.items ?? [], [donationsQ.data?.items]);

  const turnoverEvents = useMemo(
    () => donations.map((d) => ({ t: Date.parse(d.ts), v: fromMicro(d.amount) })),
    [donations],
  );
  const donorEvents = useMemo(() => {
    const firstByDonor = new Map<string, number>();
    for (const d of donations) {
      const t = Date.parse(d.ts);
      const prev = firstByDonor.get(d.donor);
      if (prev === undefined || t < prev) firstByDonor.set(d.donor, t);
    }
    return [...firstByDonor.values()].map((t) => ({ t, v: 1 }));
  }, [donations]);

  if (sessionQ.isLoading || myChannelQ.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (myChannelQ.error) {
    return <ErrorState description="Couldn't load realm." onRetry={() => myChannelQ.refetch()} />;
  }
  if (!sessionQ.data?.address) {
    return (
      <EmptyState
        title="Connect wallet"
        description="Your realm is available once your wallet is connected."
        action={<ConnectWalletButton />}
      />
    );
  }
  if (!channel) {
    return <CreateChannelForm />;
  }

  const turnover = donations.reduce((s, d) => s + d.amount, 0n);
  const net = donations.reduce((s, d) => s + d.netToStreamer, 0n);
  const weekAgo = Date.now() - 7 * DAY;
  const last7d = donations
    .filter((d) => Date.parse(d.ts) >= weekAgo)
    .reduce((s, d) => s + d.amount, 0n);
  const patrons = new Set(donations.map((d) => d.donor)).size;
  const crowns = donations.length;

  const board = boardQ.data ?? [];
  const topPatron = board[0];
  const topPatronName = topPatron ? (topPatron.displayName ?? shortAddress(topPatron.donor)) : "—";

  const tiers = configQ.data?.tiers ?? [];
  const tierCounts = tiers.map((t) => ({
    name: t.name,
    count: board.filter((e) => e.tier?.name === t.name).length,
  }));
  const tierMax = Math.max(1, ...tierCounts.map((t) => t.count));

  const GrowthChart = view === "bars" ? DailyBars : CumulativeAreaChart;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-display-l text-fg">@{channel.handle}</h1>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-caption uppercase tracking-wide",
              channel.status === "ACTIVE" ? "border-status text-status" : "border-border text-fg-faint",
            )}
          >
            {channel.status}
          </span>
        </div>
        <Link
          href={`/c/${channel.handle}`}
          className="rounded-md border border-border px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          View public →
        </Link>
      </header>

      {/* Needs attention — the moderation queue */}
      {pending > 0 ? (
        <Link
          href="/space?tab=realm-queue"
          className="flex items-center gap-3 rounded-lg border border-money-dim bg-money-bg/40 px-4 py-3 text-money transition-colors hover:border-money hover:bg-money-bg"
        >
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-money px-1 text-caption font-semibold text-[var(--bg)]">
            {pending}
          </span>
          <span className="text-small font-medium">
            {pending} message{pending === 1 ? "" : "s"} awaiting your review
          </span>
          <span className="ml-auto text-small">Open queue →</span>
        </Link>
      ) : null}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Crowned" value={money(turnover)} tone="money" />
        <Kpi label="Net earned" value={money(net)} sub="97%" tone="money" />
        <Kpi label="Last 7 days" value={money(last7d)} tone="money" />
        <Kpi label="Patrons" value={num(patrons)} />
        <Kpi label="Crowns" value={num(crowns)} />
        <Kpi label="The Crown" value={topPatronName} crown />
      </div>

      {/* Analytics */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3 text-fg">Analytics</h2>
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <RangeTabs range={range} onChange={setRange} />
          </div>
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <ChartCard title="Turnover" headline={<Amount micro={turnover} variant="money" className="text-h2" />}>
            <GrowthChart
              events={turnoverEvents}
              range={range}
              formatValue={usd}
              emptyHint="Turnover appears after the first crown."
            />
          </ChartCard>
          <ChartCard
            title="Patrons"
            headline={
              <span className="font-display text-h2 text-fg">
                {patrons} <span className="text-h3 text-fg-muted">{plural(patrons, DONORS)}</span>
              </span>
            }
          >
            <GrowthChart
              events={donorEvents}
              range={range}
              color="var(--info)"
              formatValue={(v) => `${Math.round(v)} ${plural(Math.round(v), DONORS)}`}
              emptyHint="Patrons appear after the first crown."
            />
          </ChartCard>
        </div>
      </section>

      {/* The Crown + Tier distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionHead title="The Crown" hint="Your biggest patrons" />
          {board.length === 0 ? (
            <p className="text-small text-fg-faint">No patrons yet — crowns build your court.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {board.slice(0, 6).map((e, i) => (
                <TopPatronRow key={e.donor} e={e} rank={i + 1} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionHead title="Tier distribution" hint="Patrons per rank" />
          {tierCounts.length === 0 ? (
            <p className="text-small text-fg-faint">Configure tiers in Customization.</p>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
              {tierCounts.map((t) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span className="w-20 flex-none truncate text-small text-fg-muted">{t.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-pill bg-[var(--bg)]">
                    <div
                      className="h-full rounded-pill bg-money"
                      style={{ width: `${(t.count / tierMax) * 100}%` }}
                    />
                  </div>
                  <span className="mono w-8 flex-none text-right text-small text-fg">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent crowns */}
      <section className="flex flex-col gap-3">
        {donationsQ.isLoading ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : (
          <DonationHistory donations={donations} manageChannelId={channel.id} reportable />
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  crown,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "money";
  crown?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      <span
        className={cn(
          "truncate font-display text-xl font-semibold",
          tone === "money" || crown ? "text-money" : "text-fg",
        )}
        title={value}
      >
        {crown && value !== "—" ? "👑 " : ""}
        {value}
      </span>
      {sub ? <span className="text-caption text-fg-faint">{sub}</span> : null}
    </div>
  );
}

function TopPatronRow({ e, rank }: { e: LeaderboardEntry; rank: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <span className="w-4 flex-none text-center text-caption text-fg-faint">{rank}</span>
      {/* Tier medallion — this realm's own tier (creator-defined; no global rank). */}
      <span
        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border font-display text-small"
        style={{
          borderColor: e.tier?.color ?? "var(--border)",
          color: e.tier?.color ?? "var(--text-faint)",
        }}
        aria-hidden
      >
        {(e.tier?.name ?? "—").slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-small text-fg">
          {rank === 1 ? "👑 " : ""}
          {e.displayName ?? shortAddress(e.donor)}
        </span>
        <span className="text-caption text-fg-faint">{e.tier?.name ?? "No tier"}</span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="mono text-small text-money">{money(e.totalDonated)}</span>
        <span className="text-caption text-status">{num(e.points)} Reign</span>
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
  return (
    <div
      role="group"
      aria-label="Chart view"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-[var(--bg)] p-0.5"
    >
      {(["chart", "bars"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "rounded-md px-2.5 py-1 text-small font-medium transition-colors",
            value === v ? "bg-surface-raised text-fg shadow-sm" : "text-fg-faint hover:text-fg",
          )}
        >
          {v === "chart" ? "Chart" : "Bars"}
        </button>
      ))}
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3">
      <h2 className="text-h3 text-fg">{title}</h2>
      {hint ? <p className="text-small text-fg-faint">{hint}</p> : null}
    </div>
  );
}

function ChartCard({
  title,
  headline,
  children,
}: {
  title: string;
  headline: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <span className="text-small text-fg-muted">{title}</span>
      <div className="break-words">{headline}</div>
      {children}
    </div>
  );
}
