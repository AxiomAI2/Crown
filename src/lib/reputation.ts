/**
 * Движок репутации — ОБЩИЙ чистый модуль (ADR 0001). Курс ФИКСИРОВАН: 1 USDC = 1 очко, без кривых,
 * множителей и decay (продуктовое решение, ADR 0007). Очки ДРОБНЫЕ, 1:1 к USDC с копейками (2.5 USDC →
 * 2.5 очка) — точно, без округления. Стример настраивает только ТИРЫ/ПОРОГИ (сколько очков нужно для
 * перков/участия в мини-играх), не стоимость очка. Детерминированно и перевычислимо (CLAUDE.md §4.4):
 * одинаковый журнал → одинаковая цифра везде.
 */
import type { LedgerEvent, MicroUSDC, Points, Tier } from "./data/types";

/** Фиксированный курс начисления: 1 USDC = 1 очко. */
export const POINTS_PER_USDC = 1;

/** micro-USDC в 1 очке: 1e6 micro/USDC ÷ 1 очко/USDC. Точность очков = micro (6 знаков), как у денег. */
const MICRO_PER_POINT = 1_000_000;

/**
 * Очки за донат: сумма в USDC ТОЧНО, 1:1 (2.5 USDC → 2.5 очка). Дробные — без округления, поэтому дробление
 * доната НЕЙТРАЛЬНО (0.5+0.5 = ровно 1.0, как один донат 1.0): ни накрутки (был round-half-up: 0.5·2=2>1),
 * ни потери мелочи (был floor: 0.5→0). Ставка ровно 1 очко/USDC. Порог показа текста — отдельно
 * (minDonationWithText). Number точен до 2^53 micro (~9e9 USDC); свёртка снапится к micro в computePoints.
 */
export function pointsForAmount(amountMicro: MicroUSDC): Points {
  if (amountMicro <= 0n) return 0;
  return Number(amountMicro) / MICRO_PER_POINT;
}

/**
 * Свёртка журнала донора по каналу → текущие очки (дробные). ADMIN_VOID уже отрицателен; репутация только
 * растёт (кроме него), поэтому клампим к ≥0. Детерминизм §4.4: суммируем в ЦЕЛЫХ micro-очках (каждая дельта
 * кратна 1e-6 → *1e6 даёт целое), одно деление в конце — float-дрейф (0.1+0.2) исключён, все считают одно.
 */
export function computePoints(events: LedgerEvent[]): Points {
  let micro = 0;
  for (const e of events) micro += Math.round(e.pointsDelta * MICRO_PER_POINT);
  return Math.max(0, micro) / MICRO_PER_POINT;
}

/**
 * Очки на МОМЕНТ времени (снэпшот): та же свёртка, но только по событиям с `ts ≤ asOf`. Нужно мини-играм со
 * спорами — вес голоса фиксируется на секунду поднятия спора (ADR 0015, спека игры §5), чтобы нельзя было
 * нафармить/докупить репутацию «под этот спор» после его старта. `asOf` — ISO-строка; сравнение по времени.
 */
export function computePointsAsOf(events: LedgerEvent[], asOf: string): Points {
  const cut = Date.parse(asOf);
  return computePoints(events.filter((e) => Date.parse(e.ts) <= cut));
}

export interface TierResolution {
  tier?: Tier; // undefined → очков меньше порога ПЕРВОГО тира («без тира»)
  nextTier?: Tier; // следующий рубеж; для «без тира» это первый тир
  progressToNext: number; // 0..1 (к nextTier; для «без тира» — к первому тиру от 0)
}

/**
 * Текущий тир по очкам + прогресс до следующего. Тиры/пороги — единственный рычаг стримера.
 * Тир зарабатывается с порога: если очков меньше порога ПЕРВОГО тира — тира нет (tier: undefined),
 * nextTier указывает на первый. Частный случай — первый тир с порогом 0 (как дефолтный «Новичок»): это
 * пол, его получает любой донор (ветка «ниже входа» тогда недостижима). Обе конфигурации поддержаны.
 */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) return { progressToNext: 0 }; // тиров нет вовсе
  if (points < first.threshold) {
    // ниже входа: прогресс к первому тиру от 0 (threshold > 0 здесь гарантирован проверкой выше).
    return { nextTier: first, progressToNext: first.threshold > 0 ? clamp01(points / first.threshold) : 1 };
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
