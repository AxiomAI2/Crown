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

function harness(rep: Record<string, number> = {}) {
  let slice: unknown;
  let counter = 0;
  const ledger: GameLedgerEntry[] = [];
  const ctx = (identity: string | null, t: number): GameContext => ({
    identity,
    channelId: "ch-1",
    channelOwner: STREAMER,
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
    await h.run(STREAMER, T0 + 2, "markDone", { taskId: created.id });

    // окно оспаривания прошло → стример забирает
    const claimed = (await h.run(STREAMER, T0 + 2 + WINDOWS.disputeWindow + 1, "claim", {
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

describe("спор: комьюнити решает «не выполнил» → возврат донору", async () => {
  it("донор забирает 100%, инициатору спора — бонус, доната нет", async () => {
    const h = harness({ Disputer: 1, JurorA: 4, JurorB: 3 });
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
    })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, T0 + 2, "markDone", { taskId: t.id });
    await h.run("Disputer", T0 + 3, "raiseDispute", { taskId: t.id });
    await h.run("JurorA", T0 + 4, "vote", { taskId: t.id, choice: "not_completed" });
    await h.run("JurorB", T0 + 5, "vote", { taskId: t.id, choice: "not_completed" });

    const claimed = (await h.run("Donor", T0 + 3 + WINDOWS.voting + 1, "claim", {
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
    await h.run(STREAMER, T0 + 2, "markDone", { taskId: t.id });
    await h.run("Disputer", T0 + 3, "raiseDispute", { taskId: t.id });
    await expect(
      h.run("Donor", T0 + 4, "vote", { taskId: t.id, choice: "completed" }),
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
});
