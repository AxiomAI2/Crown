"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveTier } from "@/lib/reputation";
import { cn, formatPointsCompact } from "@/lib/utils";
import type { Tier, ViewerStanding } from "@/lib/data/types";

/** Compact tier badge shown next to a handle / in the feed / on the leaderboard. */
export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-small",
        className,
      )}
      style={{ borderColor: tier.color, color: tier.color }}
    >
      <span className="h-1.5 w-1.5 rounded-pill" style={{ background: tier.color }} />
      {tier.name}
    </span>
  );
}

/** Gray-green — the forecast color for "what you'll get from a crown" (distinct from the bright --money). */
const PREVIEW_COLOR = "#6e9c86";
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * A smooth "roll" of a number from its current value to target (requestAnimationFrame, easeOutCubic). When
 * target changes, the animation continues from the already-shown value. Respects prefers-reduced-motion.
 */
function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    const from = valueRef.current;
    const to = target;
    if (from === to) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      valueRef.current = to;
      setValue(to);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (to - from) * eased);
      valueRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

/**
 * A concise standing headline — no "card within a card": label, points count and tier badge right on
 * the parent's background. With a preview: enter an amount (gain > 0) → the number "rolls" to the forecast,
 * and the bar smoothly extends in gray-green to "what you'll get". Below — progress to the next tier or a hint.
 */
export function StandingHeadline({
  standing,
  tiers,
  gain = 0,
  loading,
}: {
  standing?: ViewerStanding | null;
  tiers: Tier[];
  gain?: number;
  loading?: boolean;
}) {
  const currentPoints = standing?.points ?? 0;
  const newPoints = currentPoints + gain;
  const rolled = useCountUp(newPoints); // hook — always before the early return

  if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;
  if (tiers.length === 0) return null;

  const active = gain > 0;
  const cur = resolveTier(currentPoints, tiers);
  const proj = resolveTier(newPoints, tiers);
  const tier = active ? proj.tier : cur.tier; // while typing, show the tier you'll land in (or none)
  const isNew = !standing;

  const next = cur.nextTier;
  const floor = cur.tier?.threshold ?? 0; // "no tier" → progress floor = 0
  const span = next ? Math.max(1, next.threshold - floor) : 1;
  const curFrac = next ? clamp01((currentPoints - floor) / span) : 1;
  const projFrac = next ? clamp01((newPoints - floor) / span) : 1;
  const remaining = next ? Math.max(0, next.threshold - newPoints) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="w-fit cursor-help text-caption text-fg-faint underline decoration-dotted decoration-fg-faint/50 underline-offset-2"
              >
                My Reign
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Reign can&apos;t be bought or transferred — it&apos;s computed from your crowns to this realm.
            </TooltipContent>
          </Tooltip>
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="mono max-w-full break-all text-h1 leading-none text-fg">
              {formatPointsCompact(rolled)}
            </span>
            <span className="text-small text-fg-muted">Reign</span>
            {active ? (
              <span className="mono text-small font-medium" style={{ color: PREVIEW_COLOR }}>
                +{formatPointsCompact(gain)}
              </span>
            ) : null}
          </span>
        </div>
        {tier ? (
          <TierBadge tier={tier} className="shrink-0" />
        ) : (
          <span className="shrink-0 text-small text-fg-faint">No tier</span>
        )}
      </div>

      {next ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative h-2 overflow-hidden rounded-pill bg-surface-raised">
            {/* forecast — gray-green, smoothly extends as an amount is entered */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${projFrac * 100}%`, backgroundColor: PREVIEW_COLOR }}
            />
            {/* current progress — the next tier's color */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${curFrac * 100}%`, backgroundColor: next.color }}
            />
          </div>
          {isNew && !active ? (
            <p className="text-small text-fg-muted">
              Make your first crown to start building your Reign.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
              <span className="truncate">to {next.name}</span>
              <span className="mono shrink-0">{formatPointsCompact(remaining)} to go</span>
            </div>
          )}
        </div>
      ) : isNew && !active ? (
        <p className="text-small text-fg-muted">
          Make your first crown to start building your Reign.
        </p>
      ) : null}
    </div>
  );
}

