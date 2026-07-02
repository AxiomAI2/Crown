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
 *  §4.4 детерминизм дробной свёртки (одинаковый журнал → одинаковая цифра; снап к micro убирает float-дрейф);
 *  §4.5 «только растёт» + единственный пол — кламп к 0;
 *  фиксированный курс 1 USDC = 1 очко, дробно с копейками (ADR 0007).
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

  it("дробные очки 1:1 с копейками (2.5 USDC → 2.5 очка) — без округления", () => {
    expect(pointsForAmount(2_500_000n)).toBe(2.5); // 2.5 USDC → 2.5
    expect(pointsForAmount(500_000n)).toBe(0.5); // 0.5 → 0.5 (не теряется)
    expect(pointsForAmount(100_000n)).toBe(0.1); // 0.1 → 0.1
    expect(pointsForAmount(2_530_000n)).toBe(2.53); // 2.53 → 2.53
    expect(pointsForAmount(1_234_567n)).toBe(1.234567); // до micro-точности
  });

  it("дробление доната НЕЙТРАЛЬНО (точное 1:1: сумма кусков = целому)", () => {
    // Ни накрутки (был round-half-up: 0.5·2=2>1), ни потери (был floor: 0.5→0). Теперь ровно:
    expect(pointsForAmount(500_000n) + pointsForAmount(500_000n)).toBe(pointsForAmount(1_000_000n));
    expect(pointsForAmount(700_000n) + pointsForAmount(800_000n)).toBe(pointsForAmount(1_500_000n));
  });

  it("точность на больших суммах (Number(micro)/1e6 точен до ~9e9 USDC)", () => {
    const huge = 1_000_000_000n * USDC; // 1e9 USDC = 1e15 micro < 2^53
    expect(pointsForAmount(huge)).toBe(1_000_000_000);
    expect(pointsForAmount(huge)).toBe(pointsForAmount(huge)); // чистая функция
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

  it("DISPUTE_LOST вычитается (§4.5 — единственное протокольное списание; оператор не редактирует)", () => {
    expect(computePoints([ev("DONATION", 100), ev("DISPUTE_LOST", -30)])).toBe(70);
  });

  it("кламп к 0: репутация не уходит в минус", () => {
    expect(computePoints([ev("DONATION", 10), ev("DISPUTE_LOST", -50)])).toBe(0);
  });

  it("не зависит от порядка событий (коммутативная сумма → детерминизм §4.4)", () => {
    const forward = [ev("DONATION", 100), ev("DISPUTE_LOST", -30), ev("DONATION", 5)];
    const shuffled = [forward[2]!, forward[0]!, forward[1]!];
    expect(computePoints(shuffled)).toBe(computePoints(forward));
  });

  it("дробные дельты суммируются ТОЧНО (снап к micro убирает float-дрейф 0.1+0.2)", () => {
    // Наивное 0.1+0.2 во float = 0.30000000000000004; свёртка в целых micro-очках даёт ровно 0.3.
    expect(computePoints([ev("DONATION", 0.1), ev("DONATION", 0.2)])).toBe(0.3);
    // 2.5 + 2.53 = 5.03 ровно
    expect(computePoints([ev("DONATION", 2.5), ev("DONATION", 2.53)])).toBe(5.03);
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

  it("кламп к 0 действует и на срезе (DISPUTE_LOST до отсечки)", () => {
    const withLoss = [
      at(10, "2026-01-01T00:00:00.000Z"),
      { ...ev("DISPUTE_LOST", -50), ts: "2026-01-02T00:00:00.000Z" },
    ];
    expect(computePointsAsOf(withLoss, "2026-01-03T00:00:00.000Z")).toBe(0);
  });
});

describe("вес голоса = очки на снэпшоте (CR-1: оператор репутацию не редактирует)", () => {
  const at = (type: LedgerType, pointsDelta: number, ts: string): LedgerEvent => ({
    ...ev(type, pointsDelta),
    ts,
  });

  it("нет ручного списания оператором — вес держится на заработанных донатах", () => {
    // После удаления ADMIN_VOID у оператора нет способа записать отрицательную дельту в журнал вовсе:
    // вес голоса = честная свёртка донатов; наказание нарушителя — блок кошелька (вне журнала).
    const log = [at("DONATION", 100, "2026-01-01T00:00:00.000Z")];
    expect(computePointsAsOf(log, "2026-01-03T00:00:00.000Z")).toBe(100);
  });

  it("DISPUTE_LOST (протокольное списание за ложный спор) в весе учитывается", () => {
    const log = [
      at("DONATION", 100, "2026-01-01T00:00:00.000Z"),
      at("DISPUTE_LOST", -50, "2026-01-02T00:00:00.000Z"),
    ];
    expect(computePointsAsOf(log, "2026-01-03T00:00:00.000Z")).toBe(50);
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
