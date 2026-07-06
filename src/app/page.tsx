"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CHANNEL_PLATFORMS, platformDef } from "@/lib/channel-links";
import { CheckIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { SortToggle, type RealmSort } from "@/components/domain/realm-filters";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useDiscovery, useSession } from "@/lib/data/hooks";
import type { ChannelCard, ChannelLinkPlatform } from "@/lib/data/types";
import { channelHue, cn, fromMicro } from "@/lib/utils";

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

  // Show the one-line value prop only once we KNOW the visitor is a guest (session resolved, no address) —
  // avoids a flash for signed-in users while the session loads.
  const isGuest = Boolean(session.data) && !address;

  return (
    <div className="flex flex-col gap-6">
      {isGuest ? <GuestIntro /> : null}
      {/* The personal court is moved into "Personal Space" (header → /space); here everyone sees the realms showcase. */}
      <RealmsShowcase />
    </div>
  );
}

/**
 * Guest-only value line (no marketing hero). One sentence answers "what is this and why care", plus the
 * loop in muted micro-copy. "Reign" carries the antique-gold status accent (reputation register — not the
 * bright money gold). Hidden the moment a wallet is connected.
 */
function GuestIntro() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-5 py-4 sm:px-6 sm:py-5">
      <p className="max-w-3xl text-h3 leading-snug text-fg">
        Crown a streamer with USDC — build <span className="text-status">Reign</span>, reputation you
        earn inside their community.
      </p>
      <p className="text-small text-fg-muted">
        Crown&nbsp;→ earn Reign&nbsp;→ climb the realm&apos;s tiers. Earned, never bought or sold.
      </p>
    </div>
  );
}

function RealmsShowcase() {
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<Set<ChannelLinkPlatform>>(new Set());
  const [sort, setSort] = useState<RealmSort>("all"); // All-time / 7 days (crowned volume)

  // Show in the filter only the platforms that actually appear among the realms (no dead options),
  // in CHANNEL_PLATFORMS order.
  const availablePlatforms = useMemo(() => {
    const present = new Set<ChannelLinkPlatform>();
    for (const c of realms) for (const l of c.links ?? []) present.add(l.platform);
    return CHANNEL_PLATFORMS.map((p) => p.key).filter((k) => present.has(k));
  }, [realms]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    // Sort by crowned volume: 7 days (momentum — the top isn't frozen forever) or all-time.
    const metric = (c: ChannelCard) => (sort === "7d" ? (c.crowned7d ?? 0n) : c.totalDonated);
    return realms
      .filter((c) => !q || `${c.handle} ${c.displayName ?? ""}`.toLowerCase().includes(q))
      // Social filter: a realm passes if it has a link to ANY of the selected platforms (union).
      .filter((c) => platforms.size === 0 || (c.links ?? []).some((l) => platforms.has(l.platform)))
      .slice()
      .sort((a, b) => {
        const av = metric(a);
        const bv = metric(b);
        return bv > av ? 1 : bv < av ? -1 : 0;
      });
  }, [realms, q, sort, platforms]);

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
  const sig = `${sort}|${[...platforms].sort().join(",")}`;
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
        <h2 className="text-h3 text-fg">The realms</h2>
        {hasRealms ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Sort by crowned volume — all-time vs 7-day momentum (so the top isn't frozen forever). */}
            <SortToggle value={sort} onChange={setSort} />
            {/* Social filter — collapsed into a dropdown so it doesn't take up a row */}
            {availablePlatforms.length > 0 ? (
              <PlatformFilterMenu
                platforms={availablePlatforms}
                selected={platforms}
                onToggle={togglePlatform}
                onClear={() => setPlatforms(new Set())}
              />
            ) : null}

            <ExpandingSearch
              value={query}
              onChange={setQuery}
              placeholder="Search realms…"
              label="Search realms"
            />
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <CardGridSkeleton />
      ) : error ? (
        <ErrorState description="Couldn't load the realms." onRetry={() => refetch()} />
      ) : realms.length === 0 ? (
        <EmptyState title="No realms yet" description="Be the first to open one." />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No realms found"
          description="Try clearing the search or platform filters."
        />
      ) : (
        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
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
    </section>
  );
}

/** Social filter collapsed into a dropdown: a compact "Platforms" button + a checklist that opens on click. */
function PlatformFilterMenu({
  platforms,
  selected,
  onToggle,
  onClear,
}: {
  platforms: ChannelLinkPlatform[];
  selected: Set<ChannelLinkPlatform>;
  onToggle: (p: ChannelLinkPlatform) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  // render keeps the menu in the DOM during the close animation (we unmount on onAnimationEnd, when open=false).
  const [render, setRender] = useState(false);
  const count = selected.size;

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  // Esc closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-small transition-colors",
          count > 0 ? "text-money" : "text-fg-muted hover:text-fg",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M3 5h18l-7 8v6l-4-2v-4z" />
        </svg>
        Platforms
        {count > 0 ? (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-money px-1 text-[10px] font-semibold text-[var(--bg)]">
            {count}
          </span>
        ) : null}
      </button>

      {render ? (
        <>
          <button
            type="button"
            aria-label="Close filters"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            style={{ transformOrigin: "top right" }}
            onAnimationEnd={() => {
              if (!open) setRender(false);
            }}
            className={cn(
              "absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/40",
              open ? "animate-menu-in" : "animate-menu-out",
            )}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Platforms</span>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-caption text-fg-faint transition-colors hover:text-fg"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {platforms.map((p) => {
              const def = platformDef(p);
              if (!def) return null;
              const active = selected.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={active}
                  onClick={() => onToggle(p)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-small transition-colors",
                    active ? "text-money" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 flex-none" aria-hidden="true">
                    <path d={def.iconPath} />
                  </svg>
                  <span className="flex-1 text-left">{def.label}</span>
                  {active ? <CheckIcon className="h-4 w-4 flex-none" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function RealmCard({ realm }: { realm: ChannelCard }) {
  const hue = channelHue(realm.handle);
  const amount = realm.totalDonated;
  return (
    <div className="relative flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-all duration-200 ease-ease hover:-translate-y-0.5 hover:border-money-dim hover:shadow-[0_8px_28px_-10px_rgba(228,179,76,0.30)]">
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
              <span className="inline-flex flex-none items-center gap-1 rounded-full border border-danger px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
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
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-fg-faint transition-colors hover:border-border-strong hover:text-fg"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d={def.iconPath} />
                </svg>
              </a>
            );
          })}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border pt-4">
        <div>
          <div className="text-caption text-fg-faint">Crowned</div>
          <div className="mono text-money">{usd(amount)}</div>
        </div>
        <div className="text-right">
          <div className="text-caption text-fg-faint">Supporters</div>
          <div className="mono text-fg">{realm.donorsCount.toLocaleString("en-US")}</div>
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
