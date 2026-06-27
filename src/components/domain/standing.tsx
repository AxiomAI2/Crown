"use client";

import { Skeleton } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatPoints, plural } from "@/lib/utils";

const POINTS = ["очко", "очка", "очков"] as const;
import type { Tier, ViewerStanding } from "@/lib/data/types";

/** Компактный бейдж тира рядом с ником/в ленте/лидерборде. */
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

/**
 * Сигнатура продукта: «отчеканенная печать статуса». Standing зрителя плотным тактильным знаком,
 * который визуально НЕЛЬЗЯ купить-и-продать (вычисленная печать, не токен). Рядом — НИКОГДА нет
 * действий «передать/продать» (инвариант §4.3 + юр.-замок).
 */
export function StandingSeal({
  standing,
  fallbackTier,
  loading,
}: {
  standing?: ViewerStanding | null;
  fallbackTier?: Tier;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-28 w-full rounded-lg" />;
  }
  const tier = standing?.tier ?? fallbackTier;
  if (!tier) return null;
  const points = standing?.points ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          role="img"
          aria-label={`Standing: тир ${tier.name}, ${formatPoints(points)} ${plural(points, POINTS)}. Непередаваемо.`}
          className="flex w-full cursor-help flex-col gap-1 rounded-lg border-2 bg-status-bg p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
          style={{ borderColor: tier.color, boxShadow: `inset 0 0 0 1px ${tier.color}33` }}
        >
          <span className="text-caption" style={{ color: tier.color }}>
            {tier.name}
          </span>
          <span className="mono text-display-l leading-none" style={{ color: tier.color }}>
            {formatPoints(points)}
          </span>
          <span className="text-small" style={{ color: tier.color, opacity: 0.85 }}>
            {plural(points, POINTS)} standing
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Standing нельзя купить или передать — он считается из твоих донатов на этом канале.
      </TooltipContent>
    </Tooltip>
  );
}

/** Прогресс до следующего тира (0..1) + «осталось N очков». */
export function ReputationProgress({ standing }: { standing: ViewerStanding }) {
  if (!standing.nextTier) return null; // высший тир — без отдельной плашки
  const remaining = Math.max(0, standing.nextTier.threshold - standing.points);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-small text-fg-muted">
        <span>до «{standing.nextTier.name}»</span>
        <span className="mono">{formatPoints(remaining)} {plural(remaining, POINTS)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div
          className="h-full rounded-pill"
          style={{
            width: `${Math.round(standing.progressToNext * 100)}%`,
            background: standing.nextTier.color,
          }}
        />
      </div>
    </div>
  );
}

/** Лестница тиров канала с порогами и перками. */
export function TierLadder({ tiers, currentTierName }: { tiers: Tier[]; currentTierName?: string }) {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((t) => (
        <li
          key={t.name}
          className={cn(
            "flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2",
            t.name === currentTierName && "border-status",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TierBadge tier={t} />
              {t.perks.length > 0 ? (
                <span className="text-small text-fg-faint">
                  {t.perks.map((p) => p.label).join(" · ")}
                </span>
              ) : null}
            </div>
            <span className="mono text-small text-fg-muted">{formatPoints(t.threshold)}</span>
          </div>
          {t.description?.trim() ? (
            <p className="whitespace-pre-wrap break-words text-small text-fg-muted">{t.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
