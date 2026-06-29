import { describe, expect, it } from "vitest";
import type { LedgerEvent, LedgerType, Tier } from "./data/types";
import {
  computePoints,
  computePointsAsOf,
  pointsForAmount,
  POINTS_PER_USDC,
  resolveTier,
} from "./reputation";

/**
 * Тесты движка репутации — страховка инвариантов перед тем, как поверх него сядут мини-игры
 * (они начнут писать в журнал новые +/− события: GAME / DISPUTE_*). Фиксируем:
 *  §4.4 детерминизм и целочисленность (одинаковый журнал → одинаковая цифра, без потери точности);
 *  §4.5 «только растёт» + единственный пол — кламп к 0;
 *  фиксированный курс 1 USDC = 1 очко (ADR 0007).
 */

const USDC = 1_000_000n; // 1 USDC в micro

// — фикстуры —
function ev(type: LedgerType, pointsDelta: number, amount: bigint = 0n): LedgerEvent {
  return {
    id: `e-${type}-${pointsDelta}-${amount}`,
    donor: "Donor111",
    creator: "chan-1",
    type,
    amount,
    pointsDelta,
    configVersion: 1,
    ts: "2026-01-01T00:00:00.000Z",
  };
}

function tier(name: string, threshold: number): Tier {
  return { name, threshold, color: "#fff", badge: name.toLowerCase(), perks: [] };
}

describe("pointsForAmount — курс 1 USDC = 1 очко (ADR 0007)", () => {
  it("курс зафиксирован на 1", () => {
    expect(POINTS_PER_USDC).toBe(1);
  });

  it("1 USDC → 1 очко", () => {
    expect(pointsForAmount(USDC)).toBe(1);
  });

  it("0 и отрицательное → 0 очков", () => {
    expect(pointsForAmount(0n)).toBe(0);
    expect(pointsForAmount(-5n)).toBe(0);
  });

  it("округляет к ближайшему целому очку (полшага вверх)", () => {
    expect(pointsForAmount(400_000n)).toBe(0); // 0.4 → 0
    expect(pointsForAmount(500_000n)).toBe(1); // 0.5 → 1 (граница вверх)
    expect(pointsForAmount(600_000n)).toBe(1); // 0.6 → 1
    expect(pointsForAmount(1_499_999n)).toBe(1); // 1.499999 → 1
    expect(pointsForAmount(1_500_000n)).toBe(2); // 1.5 → 2
  });

  it("детерминизм и точность на больших суммах (bigint, без float-дрейфа)", () => {
    // 1e9 USDC — за пределами безопасной целочисленной арифметики во float через micro (1e15),
    // но целочисленный bigint-путь даёт точную цифру.
    const huge = 1_000_000_000n * USDC; // 1e9 USDC
    expect(pointsForAmount(huge)).toBe(1_000_000_000);
    // повторный вызов — тот же результат (чистая функция)
    expect(pointsForAmount(huge)).toBe(pointsForAmount(huge));
  });
});

describe("computePoints — свёртка журнала", () => {
  it("пустой журнал → 0", () => {
    expect(computePoints([])).toBe(0);
  });

  it("суммирует дельты донатов", () => {
    expect(computePoints([ev("DONATION", 100, 100n * USDC), ev("DONATION", 50, 50n * USDC)])).toBe(
      150,
    );
  });

  it("ADMIN_VOID вычитается (§4.5 — единственное списание в ядре)", () => {
    expect(computePoints([ev("DONATION", 100), ev("ADMIN_VOID", -30)])).toBe(70);
  });

  it("кламп к 0: репутация не уходит в минус", () => {
    expect(computePoints([ev("DONATION", 10), ev("ADMIN_VOID", -50)])).toBe(0);
  });

  it("не зависит от порядка событий (коммутативная сумма → детерминизм §4.4)", () => {
    const forward = [ev("DONATION", 100), ev("ADMIN_VOID", -30), ev("DONATION", 5)];
    const shuffled = [forward[2]!, forward[0]!, forward[1]!];
    expect(computePoints(shuffled)).toBe(computePoints(forward));
  });

  describe("задел под игры — не-донатные типы событий складываются так же", () => {
    it("GAME / DISPUTE_WON / DISPUTE_LOST вносят свои дельты", () => {
      expect(
        computePoints([
          ev("DONATION", 100),
          ev("GAME", -40),
          ev("DISPUTE_WON", 20),
          ev("DISPUTE_LOST", -10),
        ]),
      ).toBe(70);
    });

    it("проигрыш в игре не пробивает пол: кламп к 0", () => {
      expect(computePoints([ev("DONATION", 10), ev("GAME", -999)])).toBe(0);
    });
  });
});

describe("computePointsAsOf — снэпшот веса на момент (для спора игр)", () => {
  // событие с явным таймстампом
  const at = (pointsDelta: number, ts: string): LedgerEvent => ({
    ...ev("DONATION", pointsDelta),
    ts,
  });
  const log = [
    at(100, "2026-01-01T00:00:00.000Z"),
    at(50, "2026-02-01T00:00:00.000Z"),
    at(30, "2026-03-01T00:00:00.000Z"),
  ];

  it("считает только события с ts ≤ asOf", () => {
    expect(computePointsAsOf(log, "2026-02-15T00:00:00.000Z")).toBe(150); // 100 + 50
  });

  it("граница включительна (ts == asOf учитывается)", () => {
    expect(computePointsAsOf(log, "2026-02-01T00:00:00.000Z")).toBe(150);
  });

  it("asOf раньше всех событий → 0 (нельзя нафармить «под спор» задним числом)", () => {
    expect(computePointsAsOf(log, "2025-12-31T00:00:00.000Z")).toBe(0);
  });

  it("asOf в будущем → как полный computePoints", () => {
    expect(computePointsAsOf(log, "2027-01-01T00:00:00.000Z")).toBe(computePoints(log));
  });

  it("кламп к 0 действует и на срезе (ADMIN_VOID до отсечки)", () => {
    const withVoid = [
      at(10, "2026-01-01T00:00:00.000Z"),
      { ...ev("ADMIN_VOID", -50), ts: "2026-01-02T00:00:00.000Z" },
    ];
    expect(computePointsAsOf(withVoid, "2026-01-03T00:00:00.000Z")).toBe(0);
  });
});

describe("resolveTier — тиры/пороги (единственный рычаг стримера)", () => {
  const tiers = [tier("Bronze", 100), tier("Silver", 500), tier("Gold", 1000)];

  it("нет тиров вовсе → ни тира, ни прогресса", () => {
    expect(resolveTier(50, [])).toEqual({ progressToNext: 0 });
  });

  it("ниже порога первого тира → тир НЕ выдаётся (зарабатывается), nextTier = первый", () => {
    const r = resolveTier(50, tiers);
    expect(r.tier).toBeUndefined();
    expect(r.nextTier?.name).toBe("Bronze");
    expect(r.progressToNext).toBeCloseTo(0.5); // 50 / 100
  });

  it("ровно на пороге первого тира → тир выдан (граница включительно)", () => {
    const r = resolveTier(100, tiers);
    expect(r.tier?.name).toBe("Bronze");
    expect(r.nextTier?.name).toBe("Silver");
    expect(r.progressToNext).toBeCloseTo(0); // (100-100)/(500-100)
  });

  it("на 1 очко ниже порога → ещё без тира (не округляется вверх)", () => {
    expect(resolveTier(99, tiers).tier).toBeUndefined();
  });

  it("в середине между тирами → текущий тир + прогресс к следующему", () => {
    const r = resolveTier(300, tiers);
    expect(r.tier?.name).toBe("Bronze");
    expect(r.progressToNext).toBeCloseTo((300 - 100) / (500 - 100)); // 0.5
  });

  it("на верхнем тире → nextTier нет, прогресс = 1", () => {
    const r = resolveTier(1500, tiers);
    expect(r.tier?.name).toBe("Gold");
    expect(r.nextTier).toBeUndefined();
    expect(r.progressToNext).toBe(1);
  });

  it("порядок тиров на входе не важен (внутри сортируется)", () => {
    const reversed = [tier("Gold", 1000), tier("Bronze", 100), tier("Silver", 500)];
    expect(resolveTier(600, reversed).tier?.name).toBe("Silver");
  });
});
