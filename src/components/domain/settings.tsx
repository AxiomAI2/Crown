"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_TIERS, TIER_DESC_MAX } from "@/lib/data/fixtures";
import type { Tier } from "@/lib/data/types";

/**
 * Tier/threshold editor. The Reign rate is fixed (1 USDC = 1 point, ADR 0007) — here the streamer
 * sets THRESHOLDS in points: how much is needed for a tier/perks/participation in mini-games. Name, threshold, color.
 */
export function TierEditor({ value, onChange }: { value: Tier[]; onChange: (t: Tier[]) => void }) {
  const update = (i: number, patch: Partial<Tier>) =>
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  let ascending = true;
  for (let i = 1; i < value.length; i++) {
    const prev = value[i - 1];
    const cur = value[i];
    if (prev && cur && cur.threshold <= prev.threshold) ascending = false;
  }

  function add() {
    const lastThreshold = value.length > 0 ? (value[value.length - 1]?.threshold ?? 0) : 0;
    onChange([
      ...value,
      { name: "New tier", threshold: lastThreshold + 1000, color: "#9AA1B2", badge: "custom", perks: [] },
    ]);
  }

  // One tier = ONE compact row (color · name · threshold · note · remove). Labels live in a single header
  // line above the list — previously every row repeated four stacked labeled fields and five tiers didn't
  // fit a screen.
  const cols = "sm:grid-cols-[2.75rem_minmax(6rem,1fr)_7.5rem_minmax(8rem,1.6fr)_2.25rem]";
  return (
    <div className="flex flex-col gap-2">
      <div className={`hidden gap-2 px-2 text-small text-fg-muted sm:grid ${cols}`}>
        <span />
        <span>Name</span>
        <span>Threshold, Reign</span>
        <span>Note (optional)</span>
        <span />
      </div>
      <div className="flex flex-col gap-1.5">
        {value.map((t, i) => (
          <div
            key={i}
            className={`grid grid-cols-2 items-center gap-2 rounded-md border border-border bg-surface p-2 ${cols}`}
          >
            <input
              type="color"
              aria-label="Tier color"
              title="Tier color"
              value={t.color}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-10 w-11 cursor-pointer rounded border border-border bg-surface"
            />
            <Input
              aria-label="Name"
              value={t.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Input
              aria-label="Threshold, Reign"
              mono
              value={String(t.threshold)}
              onChange={(e) => update(i, { threshold: Number(e.target.value) || 0 })}
            />
            <div className="col-span-2 sm:col-span-1">
              <Input
                aria-label="Note (optional)"
                placeholder="A short note about the tier…"
                maxLength={TIER_DESC_MAX}
                value={t.description ?? ""}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Remove tier"
              className="justify-self-end"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={add} disabled={value.length >= MAX_TIERS} className="w-fit">
        + Add tier
      </Button>
      {value.length >= MAX_TIERS ? (
        <p className="text-small text-fg-faint">Maximum {MAX_TIERS} tiers.</p>
      ) : null}
      {!ascending ? (
        <p className="text-small text-warn">Tier thresholds must increase.</p>
      ) : null}
    </div>
  );
}
