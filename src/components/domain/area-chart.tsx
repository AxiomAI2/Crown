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
  const windowStart = range === "ALL" ? 0 : now - RANGE_MS[range];

  // Уровень, накопленный ДО окна (для 1М/1Г стартуем с него, а не с нуля).
  let base = 0;
  for (const p of series) {
    if (p.t < windowStart) base = p.y;
    else break;
  }
  // События в окне рисуем РАВНОМЕРНО ПО ИНДЕКСУ: каждый донат — ступень одинаковой ширины (а НЕ по времени —
  // иначе кластер донатов в пару дней сжимается в «плавную» полоску и резкость не видна).
  const win = range === "ALL" ? series : series.filter((p) => p.t >= windowStart);

  const W = 100;
  const H = 40;
  const maxY = Math.max(total, 1);
  const sy = (y: number) => H - (y / maxY) * H;
  const n = win.length;
  const slot = n > 0 ? W / n : W; // ширина слота одного доната

  // Ступеньки: каждый донат РЕЗКО прыгает в начале своего слота и держится по слоту. Одинаковой ширины.
  let line = `M 0 ${sy(base).toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const x0 = i * slot;
    const prevY = i === 0 ? base : win[i - 1]!.y;
    line += ` L ${x0.toFixed(2)} ${sy(prevY).toFixed(2)}`;
    line += ` L ${x0.toFixed(2)} ${sy(win[i]!.y).toFixed(2)}`;
    line += ` L ${((i + 1) * slot).toFixed(2)} ${sy(win[i]!.y).toFixed(2)}`;
  }
  if (n === 0) line += ` L ${W} ${sy(base).toFixed(2)}`; // событий в окне нет — ровная линия
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;

  // Наведение: снап к ближайшему донату — показываем его накопленное значение и дату.
  let hover: { fx: number; y: number; t: number } | null = null;
  if (hoverFx != null && n > 0) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(hoverFx * n)));
    const ev = win[idx]!;
    hover = { fx: (idx + 0.5) / n, y: ev.y, t: ev.t };
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
          strokeLinejoin="miter"
          strokeLinecap="butt"
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
