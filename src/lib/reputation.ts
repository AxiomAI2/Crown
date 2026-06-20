/**
 * Движок репутации — ОБЩИЙ чистый модуль (ADR 0001). Курс ФИКСИРОВАН: 1 USDC = 100 очков, без кривых,
 * множителей и decay (продуктовое решение, ADR 0007). Стример настраивает только ТИРЫ/ПОРОГИ (сколько
 * очков нужно для перков/участия в мини-играх), не стоимость очка. Детерминированно и перевычислимо
 * (CLAUDE.md §4.4): одинаковый журнал → одинаковая цифра везде.
 */
import type { LedgerEvent, MicroUSDC, Points, Tier } from "./data/types";
import { fromMicro } from "./utils";

/** Фиксированный курс начисления. */
export const POINTS_PER_USDC = 100;

/** Очки за донат: ровно сумма × 100, округление до целого. Не настраивается. */
export function pointsForAmount(amountMicro: MicroUSDC): Points {
  return Math.round(fromMicro(amountMicro) * POINTS_PER_USDC);
}

/**
 * Свёртка журнала донора по каналу → текущие очки. Сумма забанкованных дельт; ADMIN_VOID уже отрицателен.
 * Репутация только растёт (кроме ADMIN_VOID), поэтому клампим к ≥0.
 */
export function computePoints(events: LedgerEvent[]): Points {
  let total = 0;
  for (const e of events) total += e.pointsDelta;
  return Math.max(0, Math.round(total));
}

export interface TierResolution {
  tier: Tier;
  nextTier?: Tier;
  progressToNext: number; // 0..1
}

/** Текущий тир по очкам + прогресс до следующего. Тиры/пороги — единственный рычаг стримера. */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) {
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
