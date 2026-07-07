import type { CSSProperties } from "react";
import type { GoalTheme } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

/** Goal-widget defaults — the Crown look when a field isn't overridden by the streamer's GoalTheme. */
export const GOAL_DEFAULTS = {
  titlePos: "top" as NonNullable<GoalTheme["titlePos"]>,
  showRemaining: true,
  progressLabel: "amount_pct" as NonNullable<GoalTheme["progressLabel"]>,
  showBounds: true,
  height: 28,
  radius: 8,
  borderWidth: 0,
  trackColor: "#424242",
  fillFrom: "#f57507",
  fillTo: "#f59c07",
  fillAngle: 0,
  textSize: 14,
  textBold: true,
} as const;

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

/** Countdown to a deadline: "3d 4h left" / "5h 12m left" / "8m left" / "ended". `now` is injected for testability. */
export function formatRemaining(deadlineIso: string, now = Date.now()): string {
  const ms = Date.parse(deadlineIso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "ended";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/**
 * The donation-goal bar — a single presentational component shared by the OBS overlay (`/overlay/[handle]/goal`)
 * and the builder's live preview (Widgets → Donation goal), so the streamer sees exactly what airs. Amounts are
 * micro-USDC; `raised` already includes any head-start (`goalStart`). Text has a shadow so it reads over any bg.
 */
export function GoalBar({
  raised,
  target,
  label,
  deadlineIso,
  theme,
  now,
}: {
  raised: bigint;
  target: bigint;
  label?: string;
  deadlineIso?: string;
  theme?: GoalTheme;
  now?: number;
}) {
  const t = { ...GOAL_DEFAULTS, ...theme };
  const pct = target > 0n ? (raised >= target ? 100 : Number((raised * 100n) / target)) : 0;
  const solid = t.fillFrom === t.fillTo;
  const fill = solid ? t.fillFrom : `linear-gradient(${t.fillAngle}deg, ${t.fillFrom}, ${t.fillTo})`;
  const shadow: CSSProperties = { textShadow: "0 1px 4px rgba(0,0,0,0.85)" };
  const weight = t.textBold ? 700 : 400;
  const remaining =
    t.showRemaining && deadlineIso ? formatRemaining(deadlineIso, now) : undefined;
  const progressText =
    t.progressLabel === "pct"
      ? `${pct}%`
      : t.progressLabel === "amount_target"
        ? `${usd(raised)} / ${usd(target)}`
        : `${usd(raised)} (${pct}%)`;

  const title =
    label?.trim() && t.titlePos !== "hidden" ? (
      <div
        className="font-display text-white"
        style={{ ...shadow, fontSize: t.textSize + 2, fontWeight: weight }}
      >
        {label.trim()}
      </div>
    ) : null;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {t.titlePos === "top" ? title : null}
      {remaining ? (
        <div className="text-white/85" style={{ ...shadow, fontSize: Math.max(10, t.textSize - 3) }}>
          {remaining}
        </div>
      ) : null}
      <div
        className="relative w-full overflow-hidden"
        style={{
          height: t.height,
          borderRadius: t.radius,
          background: t.trackColor,
          border: t.borderWidth > 0 ? `${t.borderWidth}px solid rgba(255,255,255,0.5)` : undefined,
        }}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500"
          style={{ width: `${pct}%`, background: fill, borderRadius: t.radius }}
        />
        <div
          className="mono absolute inset-0 grid place-items-center text-white"
          style={{ ...shadow, fontSize: t.textSize, fontWeight: weight }}
        >
          {progressText}
        </div>
      </div>
      {t.showBounds ? (
        <div
          className="mono flex justify-between text-white/80"
          style={{ ...shadow, fontSize: Math.max(10, t.textSize - 3) }}
        >
          <span>$0</span>
          <span>{usd(target)}</span>
        </div>
      ) : null}
      {t.titlePos === "bottom" ? title : null}
    </div>
  );
}
