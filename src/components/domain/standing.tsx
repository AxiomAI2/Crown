"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveTier } from "@/lib/reputation";
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

/** Серо-зелёный — цвет прогноза «что получишь при донате» (отличается от яркого --money). */
const PREVIEW_COLOR = "#6e9c86";
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Плавный «перекат» числа от текущего значения к target (requestAnimationFrame, easeOutCubic). При смене
 * target анимация продолжается с уже показанного значения. Уважает prefers-reduced-motion.
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
 * Лаконичный заголовок standing — без «карточки в карточке»: подпись, число очков и бейдж тира прямо на
 * фоне родителя. С предпросмотром: ввёл сумму (gain > 0) → число «перекатывается» к прогнозу, а полоска
 * плавно дотягивается серо-зелёным до «что получишь». Снизу — прогресс до следующего тира или подсказка.
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
  const rolled = useCountUp(newPoints); // хук — всегда до early-return

  if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;
  if (tiers.length === 0) return null;

  const active = gain > 0;
  const cur = resolveTier(currentPoints, tiers);
  const proj = resolveTier(newPoints, tiers);
  const tier = active ? proj.tier : cur.tier; // при вводе показываем тир, в который попадёшь (или его нет)
  const isNew = !standing;

  const next = cur.nextTier;
  const floor = cur.tier?.threshold ?? 0; // «без тира» → пол прогресса = 0
  const span = next ? Math.max(1, next.threshold - floor) : 1;
  const curFrac = next ? clamp01((currentPoints - floor) / span) : 1;
  const projFrac = next ? clamp01((newPoints - floor) / span) : 1;
  const remaining = next ? Math.max(0, next.threshold - newPoints) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-fg-faint">Мой standing</span>
          <span className="flex items-baseline gap-1.5">
            <span className="mono text-h1 leading-none text-fg">{formatPoints(rolled)}</span>
            <span className="text-small text-fg-muted">{plural(rolled, POINTS)}</span>
            {active ? (
              <span className="mono text-small font-medium" style={{ color: PREVIEW_COLOR }}>
                +{formatPoints(gain)}
              </span>
            ) : null}
          </span>
        </div>
        {tier ? (
          <TierBadge tier={tier} className="shrink-0" />
        ) : (
          <span className="shrink-0 text-small text-fg-faint">Без тира</span>
        )}
      </div>

      {next ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative h-2 overflow-hidden rounded-pill bg-surface-raised">
            {/* прогноз — серо-зелёный, плавно дотягивается при вводе суммы */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${projFrac * 100}%`, backgroundColor: PREVIEW_COLOR }}
            />
            {/* текущий прогресс — цвет следующего тира */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${curFrac * 100}%`, backgroundColor: next.color }}
            />
          </div>
          {isNew && !active ? (
            <p className="text-small text-fg-muted">
              Сделай первый донат, чтобы начать набирать standing.
            </p>
          ) : (
            <div className="flex items-center justify-between text-small text-fg-faint">
              <span>до «{next.name}»</span>
              <span className="mono">осталось {formatPoints(remaining)}</span>
            </div>
          )}
        </div>
      ) : isNew && !active ? (
        <p className="text-small text-fg-muted">
          Сделай первый донат, чтобы начать набирать standing.
        </p>
      ) : null}
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
