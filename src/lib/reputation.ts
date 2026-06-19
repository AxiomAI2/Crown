/**
 * Движок репутации — ОБЩИЙ чистый модуль (ADR 0001): импортируется и моком (Фаза 1), и бэкендом
 * (Фаза 2). Это физически гарантирует инвариант «детерминирована и перевычислима» (CLAUDE.md §4.4):
 * одинаковые входы → одинаковая цифра везде.
 *
 * Полная спека формул — backend/spec.md §3, core-spec.md §5.
 */
import type {
  Curve,
  DecayConfig,
  LedgerEvent,
  MicroUSDC,
  Points,
  ReputationConfig,
  Tier,
} from "./data/types";
import { fromMicro } from "./utils";

/** Сумма (micro-USDC) → «сырые» очки по кривой (до множителей). */
export function curvePoints(amountMicro: MicroUSDC, curve: Curve): number {
  const usdc = fromMicro(amountMicro);
  switch (curve.kind) {
    case "linear":
      return usdc * curve.pointsPerUSDC; // дефолт 100
    case "sublinear":
      return Math.pow(usdc, curve.alpha) * 100; // amount^α (база 100 — привязка к linear-дефолту, ADR 0002)
    case "bracket":
      return bracketPoints(usdc, curve.brackets);
  }
}

/** Маргинальные ставки «как налог»: каждая ступень начисляется только на свою часть суммы. */
function bracketPoints(usdc: number, brackets: { upToUSDC: number | null; rate: number }[]): number {
  let points = 0;
  let prevCap = 0;
  for (const b of brackets) {
    const cap = b.upToUSDC ?? Infinity;
    const span = Math.max(0, Math.min(usdc, cap) - prevCap);
    points += span * b.rate;
    prevCap = cap;
    if (usdc <= cap) break;
  }
  return points;
}

export interface BankCtx {
  isFirstDonation: boolean;
  isStreak?: boolean;
  isEvent?: boolean;
}

function multiplierApplies(kind: "first_donation" | "streak" | "event", ctx: BankCtx): boolean {
  switch (kind) {
    case "first_donation":
      return ctx.isFirstDonation;
    case "streak":
      return Boolean(ctx.isStreak);
    case "event":
      return Boolean(ctx.isEvent);
  }
}

/** Банкинг очков в момент доната: кривая × применимые множители, округление до целого. */
export function bankPoints(amountMicro: MicroUSDC, cfg: ReputationConfig, ctx: BankCtx): Points {
  let p = curvePoints(amountMicro, cfg.curve);
  for (const m of cfg.multipliers) {
    if (multiplierApplies(m.kind, ctx)) p *= m.factor;
  }
  return Math.round(p);
}

/** Экспоненциальное затухание: доля от забанкованной дельты на момент `now`. */
export function decayFactor(tsIso: string, nowIso: string, halfLifeDays: number): number {
  const ms = Date.parse(nowIso) - Date.parse(tsIso);
  const days = ms / 86_400_000;
  return Math.pow(0.5, days / halfLifeDays);
}

/**
 * Свёртка журнала донора по каналу → текущие очки. ADMIN_VOID уже отрицателен в pointsDelta.
 * Decay (если включён) применяется поверх забанкованных дельт — детерминизм держится при фиксированном `now`.
 */
export function computePoints(
  events: LedgerEvent[],
  cfg: ReputationConfig,
  nowIso: string,
): Points {
  let total = 0;
  for (const e of events) {
    let d = e.pointsDelta;
    if (cfg.decay.enabled && cfg.decay.halfLifeDays) {
      d *= decayFactor(e.ts, nowIso, cfg.decay.halfLifeDays);
    }
    total += d;
  }
  return Math.max(0, Math.round(total));
}

export interface TierResolution {
  tier: Tier;
  nextTier?: Tier;
  progressToNext: number; // 0..1
}

/** Текущий тир по очкам + прогресс до следующего. Тиры — чистая презентация (меняются свободно). */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) {
    // Конфиг без тиров — не должно случаться; возвращаем синтетический.
    const synthetic: Tier = { name: "—", threshold: 0, color: "#9AA1B2", badge: "none", perks: [] };
    return { tier: synthetic, progressToNext: 1 };
  }
  let current = first;
  for (const t of sorted) {
    if (points >= t.threshold) current = t;
  }
  const idx = sorted.indexOf(current);
  const nextTier = sorted[idx + 1];
  const progressToNext = nextTier
    ? clamp01((points - current.threshold) / (nextTier.threshold - current.threshold))
    : 1;
  return { tier: current, nextTier, progressToNext };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Активная decay-конфигурация по умолчанию выключена (core-spec.md §5). */
export const DECAY_OFF: DecayConfig = { enabled: false };
