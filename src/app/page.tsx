"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Monogram } from "@/components/domain/header-actions";
import { AppHeader } from "@/components/layout/app-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CHANNEL_PLATFORMS, platformDef } from "@/lib/channel-links";
import { CheckIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { SortToggle, type RealmSort } from "@/components/domain/realm-filters";
import { useData } from "@/lib/data/context";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useDiscovery, useSession } from "@/lib/data/hooks";
import type { EscrowTask } from "@/games/escrow-task/types";
import type { ChannelCard, ChannelLinkPlatform } from "@/lib/data/types";

const GAME_TITLE = "Tasks for a Crown"; // the only mini-game (escrow-task) — shown as the "which game" filter label
import { channelHue, cn, fromMicro, shortAddress } from "@/lib/utils";

/** Whole-dollar format for aggregates: "$12,480". */
function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

/**
 * Home `/` — a catalog of realms for EVERYONE (guest and logged-in see the same thing). The personal space
 * (Dashboard / Customization / Settings) lives at `/space`; you get there via the "Personal Space" button in the header.
 * The catalog is not "pick a realm" but a showcase where Reigns are being built right now.
 */
export default function HomePage() {
  return (
    <>
      <AppHeader />
      {/* Atmosphere: a soft gold glow at the top, dissolving into black — so the background "breathes". */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-[var(--header-h)] -z-10 h-[520px]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, rgba(228,179,76,0.10) 0%, rgba(228,179,76,0.035) 38%, transparent 72%)",
        }}
      />
      <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:py-10 lg:px-6">
        <Home />
      </main>
      <SiteFooter />
    </>
  );
}

function Home() {
  const session = useSession();
  const dev = useDevControls();
  const address = session.data?.address ?? null;

  // Dev-only deep-link: `/?as=max` connects a seeded demo identity (mock only; inert on api/chain).
  // Handy for demoing a populated realm and for screenshots without a wallet.
  useEffect(() => {
    if (address || !dev.available) return;
    const as = new URLSearchParams(window.location.search).get("as");
    if (as) dev.setAddress(demoAddress(as));
  }, [address, dev.available]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-6">
      {/* The personal court is moved into "Personal Space" (header → /space); here everyone sees the realms showcase. */}
      <RealmsShowcase />
    </div>
  );
}

function RealmsShowcase() {
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<Set<ChannelLinkPlatform>>(new Set());
  const [sort, setSort] = useState<RealmSort>("all"); // All-time / 7 days (crowned volume)
  const [status, setStatus] = useState<"all" | "game" | "dispute">("all"); // realm activity filter

  // Per-realm mini-game state (escrow-task): which realms have a game in progress / a dispute in progress.
  const provider = useData();
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
  const { activeGameIds, disputeIds } = useMemo(() => {
    const active = new Set<string>(); // realm has a non-terminal task → "in a mini-game"
    const disp = new Set<string>(); // realm has a DISPUTED task → "in a dispute"
    taskQs.forEach((query_, i) => {
      const cid = realms[i]?.channelId;
      if (!cid) return;
      for (const t of query_.data?.tasks ?? []) {
        if (t.hidden) continue;
        if (t.status !== "RESOLVED") active.add(cid);
        if (t.status === "DISPUTED") disp.add(cid);
      }
    });
    return { activeGameIds: active, disputeIds: disp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQs.map((query_) => query_.dataUpdatedAt).join(","), realms]);

  // Show in the filter only the platforms that actually appear among the realms (no dead options),
  // in CHANNEL_PLATFORMS order.
  const availablePlatforms = useMemo(() => {
    const present = new Set<ChannelLinkPlatform>();
    for (const c of realms) for (const l of c.links ?? []) present.add(l.platform);
    return CHANNEL_PLATFORMS.map((p) => p.key).filter((k) => present.has(k));
  }, [realms]);

  // How many realms use each platform (deduped per realm) — a small count in the filter list.
  const platformCounts = useMemo(() => {
    const m = new Map<ChannelLinkPlatform, number>();
    for (const c of realms) {
      const seen = new Set<ChannelLinkPlatform>();
      for (const l of c.links ?? []) {
        if (seen.has(l.platform)) continue;
        seen.add(l.platform);
        m.set(l.platform, (m.get(l.platform) ?? 0) + 1);
      }
    }
    return m;
  }, [realms]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    // Sort by crowned volume: 7 days (momentum — the top isn't frozen forever) or all-time.
    const metric = (c: ChannelCard) => (sort === "7d" ? (c.crowned7d ?? 0n) : c.totalDonated);
    return realms
      .filter((c) => !q || `${c.handle} ${c.displayName ?? ""}`.toLowerCase().includes(q))
      // Social filter: a realm passes if it has a link to ANY of the selected platforms (union).
      .filter((c) => platforms.size === 0 || (c.links ?? []).some((l) => platforms.has(l.platform)))
      // Activity filter: realms with a mini-game in progress, or with a dispute in progress.
      .filter((c) =>
        status === "all"
          ? true
          : status === "game"
            ? activeGameIds.has(c.channelId)
            : disputeIds.has(c.channelId),
      )
      .slice()
      .sort((a, b) => {
        const av = metric(a);
        const bv = metric(b);
        return bv > av ? 1 : bv < av ? -1 : 0;
      });
  }, [realms, q, sort, platforms, status, activeGameIds, disputeIds]);

  const togglePlatform = (p: ChannelLinkPlatform) =>
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const hasRealms = !isLoading && !error && realms.length > 0;

  // Grid crossfade ONLY on sort / platform change (a real reorder): render a `shown` snapshot; when it
  // changes the old layout fades out (animate-list-out) → onAnimationEnd swaps in the new one → cascade-in.
  // Search is deliberately NOT in the signature — it filters live, so typing doesn't re-trigger the
  // animation on every keystroke (that jerked the grid).
  const sig = `${sort}|${status}|${[...platforms].sort().join(",")}`;
  const [shown, setShown] = useState<ChannelCard[]>(visible);
  const [shownSig, setShownSig] = useState(sig);
  const [leaving, setLeaving] = useState(false);

  const commitSwap = () => {
    setShown(visible);
    setShownSig(sig);
    setLeaving(false);
  };

  useEffect(() => {
    if (sig === shownSig) {
      // The controls are the same — but the content may have changed (data load/refetch): sync without animation.
      if (shown !== visible) setShown(visible);
      return;
    }
    // Empty sides (initial load / filter zeroed it out) — no crossfade, there's nothing to transition smoothly.
    if (shown.length === 0 || visible.length === 0) {
      setShown(visible);
      setShownSig(sig);
      setLeaving(false);
      return;
    }
    setLeaving(true);
  }, [sig, shownSig, shown, visible]);

  // Safeguard against "sticking": if animationend never fires — force the swap after 500ms.
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(commitSwap, 500);
    return () => window.clearTimeout(t);
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex flex-col gap-5">
      {/* Search only — always-open, grows on focus (no title, no divider). Centered. */}
      {hasRealms ? (
        <div className="flex justify-center">
          <ExpandingSearch
            size="lg"
            alwaysOpen
            value={query}
            onChange={setQuery}
            placeholder="Search realms…"
            label="Search realms"
          />
        </div>
      ) : null}

      {isLoading ? (
        <CardGridSkeleton />
      ) : error ? (
        <ErrorState description="Couldn't load the realms." onRetry={() => refetch()} />
      ) : realms.length === 0 ? (
        <EmptyState title="No realms yet" description="Be the first to open one." />
      ) : (
        // Filters on the LEFT (sticky), the realm grid on the RIGHT.
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-8">
          <FiltersPanel
            sort={sort}
            onSort={setSort}
            status={status}
            onStatus={setStatus}
            gameCount={activeGameIds.size}
            disputeCount={disputeIds.size}
            platforms={availablePlatforms}
            counts={platformCounts}
            selected={platforms}
            onToggle={togglePlatform}
            onClearPlatforms={() => setPlatforms(new Set())}
          />

          {visible.length === 0 ? (
            <EmptyState title="No realms found" description="Try clearing the search or filters." />
          ) : (
            <div
              className={cn(
                "grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5 2xl:grid-cols-4",
                leaving ? "animate-list-out" : "enter-stagger",
              )}
              onAnimationEnd={(e) => {
                if (leaving && e.target === e.currentTarget) commitSwap();
              }}
            >
              {shown.map((c) => (
                <RealmCard key={c.channelId} realm={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Left filter panel: sort, live-only, and a platform checklist. Sticky on desktop. */
type RealmStatus = "all" | "game" | "dispute";

function FiltersPanel({
  sort,
  onSort,
  status,
  onStatus,
  gameCount,
  disputeCount,
  platforms,
  counts,
  selected,
  onToggle,
  onClearPlatforms,
}: {
  sort: RealmSort;
  onSort: (v: RealmSort) => void;
  status: RealmStatus;
  onStatus: (v: RealmStatus) => void;
  gameCount: number;
  disputeCount: number;
  platforms: ChannelLinkPlatform[];
  counts: Map<ChannelLinkPlatform, number>;
  selected: Set<ChannelLinkPlatform>;
  onToggle: (p: ChannelLinkPlatform) => void;
  onClearPlatforms: () => void;
}) {
  // Status options: any realm / in a mini-game (which = "Tasks for a Crown", the only game) / in a dispute.
  const statusOpts: { k: RealmStatus; label: string; count?: number }[] = [
    { k: "all", label: "Any" },
    { k: "game", label: GAME_TITLE, count: gameCount },
    { k: "dispute", label: "In a dispute", count: disputeCount },
  ];
  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-[calc(var(--header-h)+1rem)]">
      <FilterGroup title="Sort">
        <SortToggle value={sort} onChange={onSort} />
      </FilterGroup>

      <FilterGroup title="Status">
        <div className="flex flex-col gap-0.5">
          {statusOpts.map((o) => {
            const active = status === o.k;
            return (
              <button
                key={o.k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onStatus(o.k)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-small transition-colors",
                  active ? "bg-money-bg/60 text-money" : "text-fg-muted hover:bg-surface hover:text-fg",
                )}
              >
                {o.k === "dispute" ? (
                  <span
                    className={cn("h-2 w-2 rounded-full", active ? "bg-danger" : "bg-fg-faint")}
                    aria-hidden
                  />
                ) : null}
                <span className="flex-1 text-left">{o.label}</span>
                {o.count !== undefined ? (
                  <span className="mono text-caption text-fg-faint">{o.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </FilterGroup>

      {platforms.length > 0 ? (
        <FilterGroup
          title="Platforms"
          action={selected.size > 0 ? { label: "Clear", onClick: onClearPlatforms } : undefined}
        >
          <div className="flex flex-col gap-0.5">
            {platforms.map((p) => {
              const def = platformDef(p);
              if (!def) return null;
              const active = selected.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => onToggle(p)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-small transition-colors",
                    active ? "bg-money-bg/60 text-money" : "text-fg-muted hover:bg-surface hover:text-fg",
                  )}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 flex-none overflow-visible" aria-hidden="true">
                    <path d={def.iconPath} />
                  </svg>
                  <span className="flex-1 truncate text-left">{def.label}</span>
                  <span className="mono text-caption text-fg-faint">{counts.get(p) ?? 0}</span>
                  {active ? <CheckIcon className="h-3.5 w-3.5 flex-none text-money" /> : null}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}
    </aside>
  );
}

function FilterGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption uppercase tracking-wide text-fg-faint">{title}</h3>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="text-caption text-fg-faint transition-colors hover:text-fg"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Crowned-trend sparkline — the CUMULATIVE last-~14-days curve (monotonic growth, never a jagged daily plot),
 * a smooth Catmull-Rom bezier with a gold gradient fade. Full-width, dim gold; renders nothing without activity.
 */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const gid = "spark" + useId().replace(/:/g, "");
  let run = 0;
  const cum = values.map((v) => (run += Math.max(0, v))); // running total → a clean upward line
  const max = cum[cum.length - 1] ?? 0;
  if (cum.length < 2 || max <= 0) return null;
  const W = 100;
  const H = 32;
  const PAD = 3;
  const step = W / (cum.length - 1);
  const pts = cum.map((v, i) => [i * step, H - PAD - (v / max) * (H - PAD * 2)] as const);
  const f = (n: number) => n.toFixed(2);
  let line = `M ${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("text-money-dim", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function RealmCard({ realm }: { realm: ChannelCard }) {
  const hue = channelHue(realm.handle);
  const amount = realm.totalDonated;
  const top = realm.topSupporter;
  const topName = top ? top.displayName?.trim() || shortAddress(top.address) : null;
  return (
    <div
      className="group relative flex flex-col gap-4 rounded-lg border border-border p-5 transition-all duration-200 ease-ease hover:-translate-y-px hover:border-money-dim hover:shadow-[0_6px_20px_-12px_rgba(0,0,0,0.65)]"
      // Near-flat surface with a faint top light — cards catch the same glow as the header, not flat boxes.
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025), transparent 42%), var(--surface)" }}
    >
      {/* Stretched link: the whole card is clickable into the realm; the social icons sit on top (z-20). */}
      <Link
        href={`/c/${realm.handle}`}
        aria-label={`Enter realm @${realm.handle}`}
        className="absolute inset-0 z-10 rounded-lg"
      />
      <div className="flex items-center gap-3">
        <span
          className="relative grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-lg font-display text-lg font-semibold"
          style={{
            color: `hsl(${hue} 55% 78%)`,
            background: `hsl(${hue} 45% 22% / 0.5)`,
            border: `1px solid hsl(${hue} 45% 40% / 0.5)`,
          }}
        >
          {realm.avatarUrl ? (
            // Avatar — an arbitrary external URL (next/image requires a host allowlist) → a plain <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={realm.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            realm.handle.charAt(0).toUpperCase()
          )}
        </span>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="mono truncate text-fg">@{realm.handle}</span>
            {realm.isLive ? (
              <span className="inline-flex flex-none items-center gap-1 rounded-full border border-danger/35 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-danger">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
                Live
              </span>
            ) : null}
          </div>
          {realm.displayName && (
            <span className="truncate text-small text-fg-faint">{realm.displayName}</span>
          )}
        </div>
      </div>

      {realm.links && realm.links.length > 0 && (
        <div className="relative z-20 flex flex-wrap items-center gap-1.5">
          {realm.links.map((l) => {
            const def = platformDef(l.platform);
            if (!def) return null;
            return (
              <a
                key={`${l.platform}-${l.url}`}
                href={l.url.startsWith("http") ? l.url : `https://${l.url}`}
                target="_blank"
                rel="noopener noreferrer"
                title={def.label}
                onClick={(e) => e.stopPropagation()}
                className="grid h-7 w-7 place-items-center rounded-md border border-transparent bg-surface-2 text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 overflow-visible" aria-hidden="true">
                  <path d={def.iconPath} />
                </svg>
              </a>
            );
          })}
        </div>
      )}

      {/* Bottom block — air instead of a divider. A full-width crowned-trend curve, then the money and «The Crown». */}
      <div className="mt-auto flex flex-col gap-3 pt-1">
        {realm.spark ? <Sparkline values={realm.spark} className="-mb-1 h-8 w-full" /> : null}
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-fg-faint">Crowned</span>
            <span className="mono text-h3 leading-none text-money">{usd(amount)}</span>
          </div>
          {topName ? (
            <div className="flex min-w-0 max-w-[54%] items-center gap-2" title={`The Crown — top supporter: ${topName}`}>
              <Monogram name={top!.displayName?.trim() || top!.address} avatarUrl={top!.avatarUrl} size="sm" />
              <div className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-money-dim">
                  The Crown
                </span>
                <span className="min-w-0 truncate text-small text-fg">{topName}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-lg" />
      ))}
    </div>
  );
}
