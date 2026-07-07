"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Amount } from "@/components/domain/amount";
import { CumulativeAreaChart, DailyBars, RangeTabs, type ChartRange } from "@/components/domain/area-chart";
import { CreateChannelForm } from "@/components/domain/create-channel-form";
import { CrownLogo } from "@/components/crown-logo";
import { DonationHistory } from "@/components/domain/donation-history";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { useCopied } from "@/components/ui/use-copied";
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

const SUPPORTERS = ["supporter", "supporters", "supporters"] as const;
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

  // Fundraising goal — same math as the OBS "goal" overlay: progress = all-time turnover / target.
  const goalTarget = configQ.data?.goalTarget ?? 0n;
  const goalLabel = configQ.data?.goalLabel?.trim() || "Goal";
  const goalPct =
    goalTarget > 0n ? (turnover >= goalTarget ? 100 : Number((turnover * 100n) / goalTarget)) : 0;
  const goalRemaining = goalTarget > turnover ? goalTarget - turnover : 0n;

  const avgCrown = crowns > 0 ? turnover / BigInt(crowns) : 0n;

  return (
    <div className="flex flex-col gap-8">
      <DashHeader handle={channel.handle} status={channel.status} />

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

      {/* Hero — earnings on the left, The Crown on the right. Folds the old 6-KPI row into two focused cards. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 lg:col-span-2">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(228,179,76,0.07), transparent 70%)" }}
          />
          <span className="text-caption uppercase tracking-wide text-fg-faint">Crowned · all time</span>
          <div className="mt-1">
            <Amount micro={turnover} variant="money" className="font-display text-display-l leading-none" />
          </div>
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-5">
            <Stat label="Net earned" value={money(net)} sub="97% to you" tone="money" />
            <Stat label="Last 7 days" value={money(last7d)} />
            <Stat label="Avg crown" value={money(avgCrown)} />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
          <span className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-status">
            <CrownLogo size={15} className="text-money" /> The Crown
          </span>
          {topPatron ? (
            <div className="flex items-center gap-3">
              <span
                className="grid h-11 w-11 flex-none place-items-center rounded-full border font-display"
                style={{
                  borderColor: topPatron.tier?.color ?? "var(--border)",
                  color: topPatron.tier?.color ?? "var(--text-faint)",
                }}
                aria-hidden
              >
                {(topPatron.tier?.name ?? "—").slice(0, 1).toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body text-fg">{topPatronName}</span>
                <span className="text-caption text-status">{num(topPatron.points)} Reign</span>
              </div>
              <span className="mono ml-auto font-display text-money">{money(topPatron.totalDonated)}</span>
            </div>
          ) : (
            <p className="text-small text-fg-faint">No supporters yet — crowns build your court.</p>
          )}
          <div className="mt-auto flex gap-8 border-t border-border pt-4">
            <Stat label="Supporters" value={num(patrons)} />
            <Stat label="Crowns" value={num(crowns)} />
          </div>
        </div>
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
            title="Supporters"
            headline={
              <span className="font-display text-h2 text-fg">
                {patrons} <span className="text-h3 text-fg-muted">{plural(patrons, SUPPORTERS)}</span>
              </span>
            }
          >
            <GrowthChart
              events={donorEvents}
              range={range}
              color="var(--info)"
              formatValue={(v) => `${Math.round(v)} ${plural(Math.round(v), SUPPORTERS)}`}
              emptyHint="Supporters appear after the first crown."
            />
          </ChartCard>
        </div>
      </section>

      {/* Fundraising goal — mirrors the OBS "goal" overlay; the target is set in Widgets → Donation goal. */}
      <section className="flex flex-col gap-3">
        <SectionHead title="Fundraising goal" hint="The same progress your goal overlay shows" />
        {goalTarget > 0n ? (
          <div className="flex flex-wrap items-center gap-8 rounded-lg border border-border bg-surface p-6">
            <div className="relative grid place-items-center">
              <ProgressRing pct={goalPct} />
              <div className="absolute flex flex-col items-center gap-0.5">
                <span className="font-display text-h2 text-fg">{goalPct}%</span>
                <span className="mono text-caption text-fg-faint">
                  {money(turnover)} / {money(goalTarget)}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <span className="truncate text-body font-medium text-fg">{goalLabel}</span>
              <div className="flex flex-col gap-1">
                <span className="mono font-display text-h2 text-money">{money(turnover)}</span>
                <span className="text-caption uppercase tracking-wide text-fg-faint">Collected</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="mono font-display text-h2 text-fg">{money(goalRemaining)}</span>
                <span className="text-caption uppercase tracking-wide text-fg-faint">Remaining</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-small text-fg-faint">
            No goal set.{" "}
            <Link href="/space?tab=realm-widgets" className="text-money transition-colors hover:text-money-bright">
              Set one in Widgets →
            </Link>
          </p>
        )}
      </section>

      {/* The Crown + Tier distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionHead title="The Crown" hint="Your biggest supporters" />
          {board.length === 0 ? (
            <p className="text-small text-fg-faint">No supporters yet — crowns build your court.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {board.slice(0, 6).map((e, i) => (
                <TopPatronRow key={e.donor} e={e} rank={i + 1} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionHead title="Tier distribution" hint="Supporters per rank" />
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

/** Compact stat: big value + a small caption (optional " · sub"). Used inside the hero cards. */
function Stat({
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
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          "mono font-display text-h3 font-semibold leading-none",
          tone === "money" ? "text-money" : "text-fg",
        )}
      >
        {value}
      </span>
      <span className="text-caption uppercase tracking-wide text-fg-faint">
        {label}
        {sub ? <span className="normal-case text-fg-faint/80"> · {sub}</span> : null}
      </span>
    </div>
  );
}

/** Dashboard header: @handle + status pill, with copy-link and view-public actions. Shared by both states. */
function DashHeader({ handle, status }: { handle: string; status: string }) {
  const [copied, mark] = useCopied();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-display-l text-fg">@{handle}</h1>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-caption uppercase tracking-wide",
            status === "ACTIVE" ? "border-status text-status" : "border-border text-fg-faint",
          )}
        >
          {status}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/c/${handle}`);
            mark();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          {copied ? <CheckIcon className="h-4 w-4 text-status" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <Link
          href={`/c/${handle}`}
          className="rounded-md border border-border px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          View public →
        </Link>
      </div>
    </header>
  );
}

/** Circular goal progress (0–100). Track = border token, fill = money; starts at 12 o'clock. */
function ProgressRing({ pct }: { pct: number }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <svg width={150} height={150} viewBox="0 0 150 150" className="-rotate-90" aria-hidden>
      <circle cx={75} cy={75} r={r} fill="none" stroke="var(--border)" strokeWidth={9} />
      <circle
        cx={75}
        cy={75}
        r={r}
        fill="none"
        stroke="var(--money)"
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
        className="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
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
          {rank === 1 ? (
            <CrownLogo size={14} className="mr-1 inline-block align-[-2px] text-money" />
          ) : null}
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
