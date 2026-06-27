/**
 * Движок репутации — ОБЩИЙ чистый модуль (ADR 0001). Курс ФИКСИРОВАН: 1 USDC = 100 очков, без кривых,
 * множителей и decay (продуктовое решение, ADR 0007). Стример настраивает только ТИРЫ/ПОРОГИ (сколько
 * очков нужно для перков/участия в мини-играх), не стоимость очка. Детерминированно и перевычислимо
 * (CLAUDE.md §4.4): одинаковый журнал → одинаковая цифра везде.
 */
import type { LedgerEvent, MicroUSDC, Points, Tier } from "./data/types";

/** Фиксированный курс начисления. */
export const POINTS_PER_USDC = 100;

/** Сколько micro-USDC даёт 1 очко: 1e6 micro/USDC ÷ 100 очков/USDC = 10_000 micro/очко. */
const MICRO_PER_POINT = 1_000_000n / BigInt(POINTS_PER_USDC);

/**
 * Очки за донат: сумма × 100, округление до целого. Считаем ЦЕЛОЧИСЛЕННО в bigint (не через float),
 * иначе на больших суммах Number(micro) теряет точность и независимый пересчёт не сойдётся (инвариант
 * §4.4 — детерминизм; R1/ADR 0012). Округление к ближайшему: (micro + полшага) / шаг. Суммы доната ≥ 0.
 */
export function pointsForAmount(amountMicro: MicroUSDC): Points {
  if (amountMicro <= 0n) return 0;
  return Number((amountMicro + MICRO_PER_POINT / 2n) / MICRO_PER_POINT);
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
  tier?: Tier; // undefined → очков меньше порога ПЕРВОГО тира («без тира»)
  nextTier?: Tier; // следующий рубеж; для «без тира» это первый тир
  progressToNext: number; // 0..1 (к nextTier; для «без тира» — к первому тиру от 0)
}

/**
 * Текущий тир по очкам + прогресс до следующего. Тиры/пороги — единственный рычаг стримера.
 * Если очков меньше порога ПЕРВОГО тира — тира нет (tier: undefined), а nextTier указывает на первый
 * тир: тир ЗАРАБАТЫВАЕТСЯ с его порога, а не выдаётся по умолчанию (иначе человек ниже входа ошибочно
 * получал бы первый тир).
 */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) return { progressToNext: 0 }; // тиров нет вовсе
  if (points < first.threshold) {
    // ниже входа: прогресс к первому тиру считаем от 0
    return { nextTier: first, progressToNext: clamp01(points / first.threshold) };
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
