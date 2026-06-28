"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type ChartRange = "1M" | "1Y" | "ALL";
export const CHART_RANGES: ChartRange[] = ["1M", "1Y", "ALL"];
export const RANGE_LABEL: Record<ChartRange, string> = { "1M": "1М", "1Y": "1Г", ALL: "Всё" };
const RANGE_MS: Record<ChartRange, number> = {
  "1M": 30 * 86_400_000,
  "1Y": 365 * 86_400_000,
  ALL: Number.POSITIVE_INFINITY,
};

/** Событие на оси времени: t — мс, v — прибавка к накопленному значению (деньги USDC, или 1 для счётчика). */
export interface ChartEvent {
  t: number;
  v: number;
}

function chartDate(t: number): string {
  return new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

/** Переключатель диапазона (1М/1Г/Всё) — общий для карточек графиков. */
export function RangeTabs({
  range,
  onChange,
}: {
  range: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
      {CHART_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            "rounded px-2 py-0.5 text-small transition-colors",
            range === r ? "bg-surface-raised text-fg" : "text-fg-faint hover:text-fg",
          )}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/**
 * Кумулятивная area-диаграмма «значение во времени» (события только прибавляют → монотонный рост). База оси
 * Y — 0 (площадь «наполняется»). Окно по диапазону, но не раньше первого события. Наведение → линия-курсор +
 * точка на линии + подсказка (значение через formatValue + дата). Универсальна: оборот (v=USDC) или счётчик (v=1).
 */
export function CumulativeAreaChart({
  events,
  range,
  formatValue,
  color = "var(--money)",
  emptyHint = "Пока нет данных — график появится после первого события.",
}: {
  events: ChartEvent[];
  range: ChartRange;
  formatValue: (v: number) => string;
  color?: string;
  emptyHint?: string;
}) {
  const rawId = useId();
  const gid = `chartfill-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hoverFx, setHoverFx] = useState<number | null>(null);
  const series = useMemo(() => {
    const asc = [...events].sort((a, b) => a.t - b.t);
    let running = 0;
    return asc.map((e) => {
      running += e.v;
      return { t: e.t, y: running };
    });
  }, [events]);

  if (series.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded border border-dashed border-border px-3 text-center text-small text-fg-faint">
        {emptyHint}
      </div>
    );
  }

  const now = Date.now();
  const total = series[series.length - 1]!.y;
  const firstT = series[0]!.t;
  const windowStart = range === "ALL" ? firstT : Math.max(firstT, now - RANGE_MS[range]);

  let baseY = 0;
  for (const p of series) {
    if (p.t <= windowStart) baseY = p.y;
    else break;
  }
  const visible = series.filter((p) => p.t > windowStart);
  const pts =
    range === "ALL"
      ? [...series, { t: now, y: total }]
      : [{ t: windowStart, y: baseY }, ...visible, { t: now, y: total }];

  const W = 100;
  const H = 40;
  const xMin = pts[0]!.t;
  const xMax = Math.max(now, xMin + 1);
  const maxY = Math.max(total, 1);
  const sx = (t: number) => ((t - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => H - (y / maxY) * H;

  // Кумулятив дискретных событий — это СТУПЕНЬКА: между донатами значение держится ровно, а в момент доната
  // резко прыгает (а не плавно растёт по центам). Поэтому от точки к точке идём горизонталью на прежнем
  // уровне до времени события, затем вертикалью вверх.
  let line = `M ${sx(pts[0]!.t).toFixed(2)} ${sy(pts[0]!.y).toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    line += ` L ${sx(cur.t).toFixed(2)} ${sy(prev.y).toFixed(2)} L ${sx(cur.t).toFixed(2)} ${sy(cur.y).toFixed(2)}`;
  }
  const area = `${line} L ${sx(pts[pts.length - 1]!.t).toFixed(2)} ${H} L ${sx(pts[0]!.t).toFixed(2)} ${H} Z`;

  // Значение под курсором: курсор по X → время → НАКОПЛЕННОЕ значение на этот момент (ступенька: берём
  // уровень последнего события с t ≤ курсора, без интерполяции — иначе показывало бы «промежуточные» центы).
  let hover: { fx: number; y: number; t: number } | null = null;
  if (hoverFx != null) {
    const t = xMin + hoverFx * (xMax - xMin);
    let y = pts[0]!.y;
    for (const p of pts) {
      if (p.t <= t) y = p.y;
      else break;
    }
    hover = { fx: hoverFx, y, t };
  }

  return (
    <div
      className="relative h-24 w-full"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHoverFx(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      onMouseLeave={() => setHoverFx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hover ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-fg-faint"
            style={{ left: `${hover.fx * 100}%` }}
          />
          <div
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface"
            style={{ left: `${hover.fx * 100}%`, top: `${(sy(hover.y) / H) * 100}%`, backgroundColor: color }}
          />
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface-raised px-2 py-1 text-caption shadow-md"
            style={{ left: `${Math.min(88, Math.max(12, hover.fx * 100))}%` }}
          >
            <span className="mono" style={{ color }}>
              {formatValue(hover.y)}
            </span>
            <span className="ml-1.5 text-fg-faint">{chartDate(hover.t)}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
