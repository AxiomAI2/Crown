"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANNEL_PLATFORMS, platformDef } from "@/lib/channel-links";
import { CheckIcon } from "@/components/ui/icons";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import type { ChannelCard, ChannelLinkPlatform } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export type RealmSort = "all" | "7d";

/**
 * Shared realms showcase logic (the same as on the home page): search + sort by volume (all-time / 7d) +
 * filter by socials (union). Returns state, the filtered list and helpers — rendering is separate
 * (RealmFilterToolbar), so it can be used both in the catalog and in the admin panel.
 */
export function useRealmFilter(realms: ChannelCard[]) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RealmSort>("all");
  const [platforms, setPlatforms] = useState<Set<ChannelLinkPlatform>>(new Set());

  const availablePlatforms = useMemo(() => {
    const present = new Set<ChannelLinkPlatform>();
    for (const c of realms) for (const l of c.links ?? []) present.add(l.platform);
    return CHANNEL_PLATFORMS.map((p) => p.key).filter((k) => present.has(k));
  }, [realms]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const metric = (c: ChannelCard) => (sort === "7d" ? (c.crowned7d ?? 0n) : c.totalDonated);
    return realms
      .filter((c) => !q || `${c.handle} ${c.displayName ?? ""}`.toLowerCase().includes(q))
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

  return {
    query,
    setQuery,
    sort,
    setSort,
    platforms,
    availablePlatforms,
    togglePlatform,
    clearPlatforms: () => setPlatforms(new Set()),
    visible,
  };
}

export type RealmFilter = ReturnType<typeof useRealmFilter>;

/** Showcase control panel: sort + socials filter (dropdown) + expanding search. */
export function RealmFilterToolbar({ filter }: { filter: RealmFilter }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SortToggle value={filter.sort} onChange={filter.setSort} />
      {filter.availablePlatforms.length > 0 ? (
        <PlatformFilterMenu
          platforms={filter.availablePlatforms}
          selected={filter.platforms}
          onToggle={filter.togglePlatform}
          onClear={filter.clearPlatforms}
        />
      ) : null}
      <ExpandingSearch
        value={filter.query}
        onChange={filter.setQuery}
        placeholder="Search realms…"
        label="Search realms"
      />
    </div>
  );
}

export function SortToggle({ value, onChange }: { value: RealmSort; onChange: (v: RealmSort) => void }) {
  const opts: { k: RealmSort; label: string }[] = [
    { k: "all", label: "All-time" },
    { k: "7d", label: "7 days" },
  ];
  return (
    <div
      role="group"
      aria-label="Sort realms by crowned volume"
      title="Sort by Crowned volume"
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
  const count = selected.size;

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

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close filters"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/40"
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
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 flex-none overflow-visible" aria-hidden="true">
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
