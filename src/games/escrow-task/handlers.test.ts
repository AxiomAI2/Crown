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

function harness(
  rep: Record<string, number> = {},
  channelPayout: string | null = "Payout1",
  escrowOutcome?: GameContext["escrowOutcome"],
  // По умолчанию auto_if_clean → задание сразу SHOWN, чтобы lifecycle-тесты могли принять без явного показа.
  // Модерационные тесты передают "manual" (тогда HELD).
  textShowMode: GameContext["textShowMode"] = "auto_if_clean",
  escrowState?: GameContext["escrowState"], // ESC-19: сырое ончейн-состояние (для теста раскрытия по accept)
  isContentBlocked?: GameContext["isContentBlocked"], // операторский тейкдаун (модерация платформы)
) {
  let slice: unknown;
  let counter = 0;
  const ledger: GameLedgerEntry[] = [];
  const ctx = (identity: string | null, t: number): GameContext => ({
    identity,
    channelId: "ch-1",
    channelOwner: STREAMER,
    channelPayout,
    escrowOutcome,
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
    textShowMode,
    escrowState,
    isContentBlocked,
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

describe("ESC-14: claim неполучателем не чеканит репутацию повторно", () => {
  it("многократный claim донором (не победитель) банкует DONATION РОВНО один раз", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    const at = TD + WINDOWS.disputeWindow + 1; // исход to_streamer → победитель стример, не донор
    // Донор (НЕ победитель) долбит claim: первый раз резолвит+банкует, дальше задание уже RESOLVED → только
    // NOT_WINNER без повторной банковки. До фикса каждый вызов чеканил DONATION (статус не персистился).
    for (let i = 0; i < 3; i++)
      await expect(h.run("Donor", at, "claim", { taskId: t.id })).rejects.toMatchObject({
        code: "NOT_WINNER",
      });
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("M3: chain-backed задание банкуется ТОЛЬКО при известном ончейн-исходе", () => {
  // Дозреваем задание с escrowTaskId до to_streamer (DONE + окно спора прошло), варьируем escrowOutcome.
  const mature = async (h: ReturnType<typeof harness>) => {
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    return { t, at: TD + WINDOWS.disputeWindow + 1 };
  };

  it("исход неизвестен (эскроу закрыт, индексер ещё не записал) → НЕ банкует, откладывает", async () => {
    const h = harness({}, "Payout1", async () => null);
    const { at } = await mature(h);
    const r = (await h.run(null, at, "settleDue")) as { settled: number };
    expect(r.settled).toBe(0); // отложено — никакого офчейн-таймера
    expect(h.ledger).toEqual([]);
  });

  it("индексер зафиксировал claim → to_streamer → банкует DONATION донору (истина денег)", async () => {
    const h = harness({}, "Payout1", async () => "to_streamer");
    const { at } = await mature(h);
    const r = (await h.run(null, at, "settleDue")) as { settled: number };
    expect(r.settled).toBe(1);
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("ESC-18 / ESC-6: привязка ончейн-эскроу к каналу", () => {
  it("ESC-18: повторный escrowTaskId отклоняется (одно зеркало на один платёж)", async () => {
    const h = harness();
    await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X", escrowTaskId: "abc123" });
    await expect(
      h.run("Donor", T0 + 1, "create", { amount: AMOUNT, text: "Y", escrowTaskId: "abc123" }),
    ).rejects.toMatchObject({ code: "ESCROW_REUSED" });
  });

  it("ESC-6 fail-closed: chain-эскроу без payout канала отклоняется", async () => {
    const h = harness({}, null); // канал без payoutAddress
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "X", escrowTaskId: "abc123" }),
    ).rejects.toMatchObject({ code: "NO_PAYOUT" });
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

describe("очередь модерации текста задания (textState)", () => {
  it("manual → HELD; стример «Показать» → SHOWN; чужой → FORBIDDEN", async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "сделай X" })) as EscrowTask;
    expect(t.textState).toBe("HELD"); // в очередь, не на страницу
    await expect(
      h.run("NotOwner", T0, "setTextState", { taskId: t.id, state: "SHOWN" }),
    ).rejects.toThrow(); // только владелец
    const shown = (await h.run(STREAMER, T0, "setTextState", {
      taskId: t.id,
      state: "SHOWN",
    })) as EscrowTask;
    expect(shown.textState).toBe("SHOWN");
    expect(shown.status).toBe("PENDING"); // модерация текста не двигает деньги/статус (§7)
  });

  it("auto_if_clean + чистый текст → сразу SHOWN (без очереди)", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "сделай X" })) as EscrowTask;
    expect(t.textState).toBe("SHOWN");
  });

  it("«Показать» после истечения таймера запрещено (TEXT_LOCKED) — публиковать поздно", async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "сделай X" })) as EscrowTask;
    // Окно принятия истекло (PENDING → expired, уходит в возврат донору) → текст уже не показать.
    await expect(
      h.run(STREAMER, T0 + WINDOWS.accept + 1, "setTextState", { taskId: t.id, state: "SHOWN" }),
    ).rejects.toMatchObject({ code: "TEXT_LOCKED" });
  });

  it("ESC-19: accept РАСКРЫВАЕТ текст — HELD → accept делает ACCEPTED + SHOWN", async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "сделай X" })) as EscrowTask;
    expect(t.textState).toBe("HELD");
    const accepted = (await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id })) as EscrowTask;
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.textState).toBe("SHOWN"); // принятие публикует текст
  });

  it("ESC-19: после accept «скрыть» текст запрещено (TEXT_LOCKED) — деньги ⟹ текст на виду", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "сделай X" })) as EscrowTask;
    // До accept скрыть можно (денег к стримеру ещё нет).
    const hidden = (await h.run(STREAMER, T0, "setTextState", {
      taskId: t.id,
      state: "HIDDEN",
    })) as EscrowTask;
    expect(hidden.textState).toBe("HIDDEN");
    // Принимаем — текст снова публичен; теперь скрыть уже нельзя.
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await expect(
      h.run(STREAMER, T0 + 2, "setTextState", { taskId: t.id, state: "HIDDEN" }),
    ).rejects.toMatchObject({ code: "TEXT_LOCKED" });
  });

  it("ESC-19: ончейн-accept (escrowState=Accepted) → settleDue раскрывает текст МИМО UI", async () => {
    const h = harness({}, "Payout1", undefined, "manual", async () => 1); // 1 = Accepted на цепочке
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    expect(t.textState).toBe("HELD");
    await h.run(null, T0 + 1, "settleDue"); // фоновый сеттлер (без личности) — как индексер
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.textState).toBe("SHOWN"); // индексер увидел ончейн-accept и раскрыл текст
  });

  it("ESC-19: «Отклонить» (hidden) + ончейн-accept МИМО UI → settleDue возвращает задание в ленту", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean", async () => 1); // 1 = Accepted на цепочке
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    // Стример «отклонил» (спрятал из ленты), рассчитывая на возврат по таймеру…
    const hidden = (await h.run(STREAMER, T0, "hide", { taskId: t.id })) as EscrowTask;
    expect(hidden.hidden).toBe(true);
    // …но затем принял эскроу НАПРЯМУЮ ончейн (мимо сайта) и целится забрать деньги.
    await h.run(null, T0 + 1, "settleDue"); // индексер видит accept на цепочке
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.hidden).toBe(false); // задание вернулось в ленту — комьюнити увидит и сможет оспорить
    expect(after.textState).toBe("SHOWN");
    expect(after.status).toBe("ACCEPTED");
  });

  it("операторский тейкдаун ПЕРЕБИВАЕТ авто-раскрытие: settleDue не раскрывает, list помечает operatorBlocked", async () => {
    const blocked = new Set<string>();
    // escrowState=1 (Accepted) — обычно индексер раскрыл бы текст; но оператор снял задание.
    const h = harness({}, "Payout1", undefined, "manual", async () => 1, (id) => blocked.has(id));
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "сделай X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    blocked.add(t.id); // оператор снял контент с публикации
    await h.run(null, T0 + 1, "settleDue"); // индексер видит ончейн-accept…
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.textState).toBe("HELD"); // …но текст НЕ раскрыт — тейкдаун перебивает раскрытие
    expect(after.operatorBlocked).toBe(true); // запрос помечает снятое (isTextPublic → false в UI)
  });
});

describe("hide («Отклонить» = скрыть без ончейна/резолва; возврат по таймеру)", () => {
  it("владелец скрывает → hidden=true без резолва; чужой → FORBIDDEN", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await expect(h.run("NotOwner", T0, "hide", { taskId: t.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const hidden = (await h.run(STREAMER, T0, "hide", { taskId: t.id })) as EscrowTask;
    expect(hidden.hidden).toBe(true);
    expect(hidden.status).toBe("PENDING"); // не резолвим — эскроу вернётся донору сам по таймеру
    expect(hidden.resolution).toBeUndefined();
  });
});
