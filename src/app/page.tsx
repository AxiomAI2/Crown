"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CHANNEL_PLATFORMS, platformDef } from "@/lib/channel-links";
import { CheckIcon } from "@/components/ui/icons";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useDiscovery, useSession } from "@/lib/data/hooks";
import type { ChannelCard, ChannelLinkPlatform } from "@/lib/data/types";
import { channelHue, cn, fromMicro } from "@/lib/utils";

/** Whole-dollar format for aggregates: "$12,480". */
function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

/**
 * Home `/` — каталог дворов для ВСЕХ (гость и залогиненный видят одно и то же). Личное пространство
 * (Dashboard / Customization / Settings) живёт на `/space`; вход туда — кнопкой «Personal Space» в шапке.
 * Каталог — не «выбери канал», а витрина, где репутации строятся прямо сейчас.
 */
export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-content px-4 py-8 sm:py-10">
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
      {/* Личный корт вынесен в «Personal Space» (шапка → /space); здесь у всех — витрина дворов. */}
      <RealmsShowcase />
    </div>
  );
}

function RealmsShowcase() {
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<Set<ChannelLinkPlatform>>(new Set());

  // Показываем в фильтре только те платформы, что реально встречаются у дворов (без мёртвых опций),
  // в порядке CHANNEL_PLATFORMS.
  const availablePlatforms = useMemo(() => {
    const present = new Set<ChannelLinkPlatform>();
    for (const c of realms) for (const l of c.links ?? []) present.add(l.platform);
    return CHANNEL_PLATFORMS.map((p) => p.key).filter((k) => present.has(k));
  }, [realms]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const metric = (c: ChannelCard) => c.totalDonated;
    return realms
      .filter((c) => !q || `${c.handle} ${c.displayName ?? ""}`.toLowerCase().includes(q))
      // Соц-фильтр: двор проходит, если у него есть ссылка на ЛЮБУЮ из выбранных платформ (union).
      .filter((c) => platforms.size === 0 || (c.links ?? []).some((l) => platforms.has(l.platform)))
      .slice()
      .sort((a, b) => {
        const av = metric(a);
        const bv = metric(b);
        return bv > av ? 1 : bv < av ? -1 : 0;
      });
  }, [realms, q, platforms]);

  const togglePlatform = (p: ChannelLinkPlatform) =>
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const hasRealms = !isLoading && !error && realms.length > 0;

  // Кроссфейд сетки при смене сортировки/фильтра/поиска: рендерим снимок `shown`; при изменении контролов
  // старая раскладка гаснет (animate-list-out) → на onAnimationEnd подменяем на новую → каскад-вход.
  const sig = `${q}|${[...platforms].sort().join(",")}`;
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
      // Контролы те же — но контент мог смениться (загрузка/рефетч данных): синхронизируем без анимации.
      if (shown !== visible) setShown(visible);
      return;
    }
    // Пустые стороны (начальная загрузка / фильтр обнулил) — без кроссфейда, менять нечего плавно.
    if (shown.length === 0 || visible.length === 0) {
      setShown(visible);
      setShownSig(sig);
      setLeaving(false);
      return;
    }
    setLeaving(true);
  }, [sig, shownSig, shown, visible]);

  // Страховка от «залипания»: если animationend не придёт — принудительная подмена через 500мс.
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
            {/* Фильтр по соцсетям — свёрнут в дропдаун, чтобы не занимать ряд */}
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
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
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

/** Фильтр по соцсетям, свёрнутый в дропдаун: компактная кнопка «Platforms» + список-чеклист по клику. */
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
  // render держит меню в DOM во время анимации закрытия (размонтируем на onAnimationEnd, когда open=false).
  const [render, setRender] = useState(false);
  const count = selected.size;

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  // Esc закрывает меню.
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
      {/* Растянутая ссылка: вся карточка кликабельна во двор; соц-иконки лежат поверх (z-20). */}
      <Link
        href={`/c/${realm.handle}`}
        aria-label={`Enter realm @${realm.handle}`}
        className="absolute inset-0 z-10 rounded-lg"
      />
      <div className="flex items-center gap-3">
        <span
          className="grid h-11 w-11 flex-none place-items-center rounded-lg font-display text-lg font-semibold"
          style={{
            color: `hsl(${hue} 55% 78%)`,
            background: `hsl(${hue} 45% 22% / 0.5)`,
            border: `1px solid hsl(${hue} 45% 40% / 0.5)`,
          }}
        >
          {realm.handle.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="mono truncate text-fg">@{realm.handle}</span>
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

      <div className="mt-auto border-t border-border pt-4">
        <div className="text-caption text-fg-faint">Crowned</div>
        <div className="mono text-money">{usd(amount)}</div>
      </div>
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-lg" />
      ))}
    </div>
  );
}
