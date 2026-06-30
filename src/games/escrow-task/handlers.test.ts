import { describe, expect, it } from "vitest";
import { dispatchGame, type GameContext, type GameLedgerEntry } from "../bus";
import { escrowTaskHandlers } from "./handlers";
import { WINDOWS } from "./machine";
import type { EscrowTask } from "./types";

/**
 * Интеграционные тесты обработчиков «задание-донат» через game-bus: полный цикл (happy-path и спор),
 * банковка эффектов на репутацию при claim, и авторизация. Стор имитируем замыканием (слайс состояния +
 * сток журнала + управляемые часы + карта репутации), как сделал бы провайдер.
 */

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const STREAMER = "Streamer";
const AMOUNT = "5000000"; // 5 USDC → 5 очков; кворум = 5
const TD = T0 + WINDOWS.grace + 2; // «Готово» — сразу после грейса отмены донора (ESC-13)

function harness(rep: Record<string, number> = {}) {
  let slice: unknown;
  let counter = 0;
  const ledger: GameLedgerEntry[] = [];
  const ctx = (identity: string | null, t: number): GameContext => ({
    identity,
    channelId: "ch-1",
    channelOwner: STREAMER,
    channelPayout: null,
    now: () => new Date(t).toISOString(),
    newId: () => `task-${++counter}`,
    state: {
      get: <T = unknown>() => slice as T | undefined,
      set: (v: unknown) => {
        slice = v;
      },
    },
    reputationAsOf: (address) => rep[address] ?? 0,
    bankLedger: (entries) => ledger.push(...entries),
    moderate: async (text) => (/убей|укради/i.test(text) ? "HARD_BLOCK" : "CLEAR"),
    verifyEscrow: async () => true,
  });
  const run = (identity: string | null, t: number, op: string, payload?: unknown) =>
    dispatchGame(
      { "escrow-task": escrowTaskHandlers },
      "escrow-task",
      "action",
      op,
      ctx(identity, t),
      payload,
    );
  const query = (op: string, payload?: unknown) =>
    dispatchGame(
      { "escrow-task": escrowTaskHandlers },
      "escrow-task",
      "query",
      op,
      ctx(null, T0),
      payload,
    );
  return { run, query, ledger };
}

describe("happy-path: создал → принял → готово → (окно прошло) → claim стримером", () => {
  it("деньги стримеру, донору +очки за дошедший донат", async () => {
    const h = harness();
    const created = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
    })) as EscrowTask;
    expect(created.status).toBe("PENDING");
    await h.run(STREAMER, T0 + 1, "accept", { taskId: created.id });
    await h.run(STREAMER, TD, "markDone", { taskId: created.id });

    // окно оспаривания прошло → стример забирает
    const claimed = (await h.run(STREAMER, TD + WINDOWS.disputeWindow + 1, "claim", {
      taskId: created.id,
    })) as EscrowTask;
    expect(claimed.resolution).toMatchObject({
      outcome: "to_streamer",
      reason: "completed",
      claimed: true,
    });
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("settleDue: фоновый резолв по времени банкует репутацию без claim (permissionless)", () => {
  it("DONE без спора после окна → DONATION донору, идемпотентно", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });

    // Окно спора прошло → сеттлер (без личности) резолвит и банкует, не дожидаясь claim.
    const r1 = (await h.run(null, TD + WINDOWS.disputeWindow + 1, "settleDue")) as {
      settled: number;
    };
    expect(r1.settled).toBe(1);
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);

    // Повторный прогон — ничего нового (идемпотентно: уже RESOLVED).
    const r2 = (await h.run(null, TD + WINDOWS.disputeWindow + 2, "settleDue")) as {
      settled: number;
    };
    expect(r2.settled).toBe(0);
    expect(h.ledger).toHaveLength(1);
  });
});

describe("спор: комьюнити решает «не выполнил» → возврат донору", async () => {
  it("донор забирает 100%, инициатору спора — бонус, доната нет", async () => {
    const h = harness({ Disputer: 1, JurorA: 4, JurorB: 3 });
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
    })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disputer", TD + 1, "raiseDispute", { taskId: t.id });
    await h.run("JurorA", TD + 2, "vote", { taskId: t.id, choice: "not_completed" });
    await h.run("JurorB", TD + 3, "vote", { taskId: t.id, choice: "not_completed" });

    const claimed = (await h.run("Donor", TD + 1 + WINDOWS.voting + 1, "claim", {
      taskId: t.id,
    })) as EscrowTask;
    expect(claimed.resolution).toMatchObject({
      outcome: "to_donor",
      reason: "vote_not_completed",
      claimed: true,
    });
    expect(h.ledger).toEqual([{ address: "Disputer", type: "DISPUTE_WON", pointsDelta: 10 }]);
  });
});

describe("авторизация", () => {
  it("принять может только владелец канала; донор не голосует в своём споре", async () => {
    const h = harness({ Disputer: 1 });
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await expect(h.run("Donor", T0 + 1, "accept", { taskId: t.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disputer", TD + 1, "raiseDispute", { taskId: t.id });
    await expect(
      h.run("Donor", TD + 2, "vote", { taskId: t.id, choice: "completed" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("query list возвращает задания канала", async () => {
    const h = harness();
    await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" });
    const res = (await h.query("list")) as { tasks: EscrowTask[] };
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]!.text).toBe("X");
  });

  it("нелегальное задание не создаётся (модерация HARD_BLOCK)", async () => {
    const h = harness();
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "убей того парня" }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TASK" });
    expect(((await h.query("list")) as { tasks: EscrowTask[] }).tasks).toHaveLength(0);
  });
});

describe("disputeVotes — постранично, фильтр по стороне, поиск, агрегат (масштаб)", () => {
  type Result = {
    found: boolean;
    total: number;
    votes: { voter: string; choice: string; weight: number }[];
    dispute?: {
      tally: { completed: number; not: number; completedVotes: number; notVotes: number };
    };
  };

  async function disputed() {
    const h = harness({ Disp: 1, A: 5, B: 3, C: 2 });
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disp", TD + 1, "raiseDispute", { taskId: t.id });
    await h.run("A", TD + 2, "vote", { taskId: t.id, choice: "completed" });
    await h.run("B", TD + 3, "vote", { taskId: t.id, choice: "completed" });
    await h.run("C", TD + 4, "vote", { taskId: t.id, choice: "not_completed" });
    return { h, taskId: t.id };
  }

  it("страница + сортировка по весу + агрегат по ВСЕМ голосам", async () => {
    const { h, taskId } = await disputed();
    const r = (await h.query("disputeVotes", {
      taskId,
      page: 0,
      pageSize: 2,
      sort: "weight",
    })) as Result;
    expect(r.total).toBe(3);
    expect(r.votes.map((v) => v.voter)).toEqual(["A", "B"]); // вес 5,3 — первая страница из 2
    expect(r.dispute!.tally).toMatchObject({
      completed: 8,
      not: 2,
      completedVotes: 2,
      notVotes: 1,
    });
  });

  it("фильтр по стороне и поиск по адресу", async () => {
    const { h, taskId } = await disputed();
    const onlyNot = (await h.query("disputeVotes", { taskId, side: "not_completed" })) as Result;
    expect(onlyNot.total).toBe(1);
    expect(onlyNot.votes[0]!.voter).toBe("C");
    const search = (await h.query("disputeVotes", { taskId, q: "a" })) as Result;
    expect(search.votes.every((v) => v.voter.toLowerCase().includes("a"))).toBe(true);
  });

  it("нет спора → found:false", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    expect(((await h.query("disputeVotes", { taskId: t.id })) as Result).found).toBe(false);
  });
});
