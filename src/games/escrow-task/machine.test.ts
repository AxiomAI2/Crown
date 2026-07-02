import { describe, expect, it } from "vitest";
import { GameBusError } from "../bus";
import {
  accept,
  cancel,
  castVote,
  claim,
  createTask,
  dueResolution,
  hide,
  isTextPublic,
  DISPUTE_LOSS_PENALTY,
  DISPUTE_WIN_BONUS,
  markDone,
  raiseDispute,
  reject,
  repEffects,
  report,
  REPORT_HIDE_THRESHOLD,
  tally,
  WINDOWS,
} from "./machine";
import type { EscrowTask, TaskVote } from "./types";

/**
 * Тесты стейт-машины «задание-донат» — чистая логика по спеке §5/§6/§11: переходы, окна по времени,
 * подсчёт голосов по весу и эффекты на репутацию (ADR 0015). Время детерминировано (nowMs).
 */

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const AMOUNT = "5000000"; // 5 USDC → 5 очков (pointsForAmount)
const STREAMER = "Streamer1";
const TD = T0 + WINDOWS.grace + 1; // время «Готово» — сразу ПОСЛЕ грейса отмены донора (ESC-13)

function newTask(executionMs?: number): EscrowTask {
  return createTask(
    { id: "t1", channelId: "ch-1", donor: "Donor1", amount: AMOUNT, text: "сделай X", executionMs },
    T0,
  );
}
const vote = (voter: string, choice: TaskVote["choice"], weight: number): TaskVote => ({
  voter,
  choice,
  weight,
  at: "2026-01-01T00:00:00.000Z",
});
// Машина бросает GameBusError с кодом в .code (а .message — русский текст) → проверяем именно код.
function throwsCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof GameBusError ? e.code : `NOT_BUS_ERROR:${String(e)}`;
  }
  return "NO_THROW";
}

describe("создание и принятие", () => {
  it("createTask → PENDING с дедлайном СДАЧИ (от создания) и клампом срока", () => {
    const t = newTask(999 * WINDOWS.executionMax); // выше потолка → клампится
    expect(t.status).toBe("PENDING");
    // Дедлайн сдачи = создание + клампленный срок (от СОЗДАНИЯ = ончейн done_deadline от fund).
    expect(Date.parse(t.executionDeadline)).toBe(T0 + WINDOWS.executionMax);
  });

  it("accept → ACCEPTED; грейс и срок сдачи заданы при СОЗДАНИИ, accept их не сбрасывает", () => {
    const t = accept(newTask(), T0 + 1000);
    expect(t.status).toBe("ACCEPTED");
    expect(Date.parse(t.graceUntil!)).toBe(T0 + WINDOWS.grace); // от создания (= ончейн accept_deadline), не от accept
    expect(Date.parse(t.executionDeadline)).toBe(T0 + WINDOWS.executionDefault); // от создания, не от accept
  });

  it("accept после срока сдачи → ACCEPT_EXPIRED", () => {
    expect(throwsCode(() => accept(newTask(), T0 + WINDOWS.executionDefault + 1))).toBe(
      "ACCEPT_EXPIRED",
    );
  });

  it("reject → возврат; cancel только в грейс-окне; после «Готово» нельзя", () => {
    expect(reject(newTask(), T0 + 1).resolution).toMatchObject({
      outcome: "to_donor",
      reason: "rejected",
    });
    const acc = accept(newTask(), T0);
    expect(cancel(acc, T0 + WINDOWS.grace - 1).resolution).toMatchObject({ reason: "canceled" });
    expect(throwsCode(() => cancel(acc, T0 + WINDOWS.grace + 1))).toBe("GRACE_OVER");
    const done = markDone(acc, TD);
    expect(throwsCode(() => cancel(done, TD + 1))).toBe("NOT_OPEN");
  });
});

describe("выполнение и спор", () => {
  const accepted = () => accept(newTask(), T0);

  it("markDone → DONE с окном оспаривания (без пруфа)", () => {
    const d = markDone(accepted(), TD);
    expect(d.status).toBe("DONE");
    expect(Date.parse(d.disputeWindowEndsAt!)).toBe(TD + WINDOWS.disputeWindow);
  });

  it("markDone в грейс-окне → GRACE_ACTIVE (ESC-13: стример не фронт-раннит отмену донора)", () => {
    expect(throwsCode(() => markDone(accepted(), T0 + WINDOWS.grace - 1))).toBe("GRACE_ACTIVE");
  });

  it("markDone после срока → EXEC_OVER (логика no-show — в dueResolution)", () => {
    expect(throwsCode(() => markDone(accepted(), T0 + WINDOWS.executionDefault + 1))).toBe(
      "EXEC_OVER",
    );
  });

  it("raiseDispute → DISPUTED; повторный голос отклоняется", () => {
    const done = markDone(accepted(), TD);
    let disp = raiseDispute(done, "Juror0", 100, TD + 1);
    expect(disp.status).toBe("DISPUTED");
    disp = castVote(disp, vote("JurorA", "completed", 30), TD + 2);
    expect(throwsCode(() => castVote(disp, vote("JurorA", "not_completed", 30), TD + 3))).toBe(
      "ALREADY_VOTED",
    );
  });
});

describe("подсчёт голосов (tally) по весу", () => {
  const disp = (votes: TaskVote[], quorum: number) => ({
    by: "J0",
    openedAt: "x",
    votingEndsAt: "x",
    quorum,
    votes,
  });

  it("вес «выполнил» > «не выполнил» → стримеру (vote_completed)", () => {
    expect(tally(disp([vote("a", "completed", 60), vote("b", "not_completed", 40)], 50))).toEqual({
      outcome: "to_streamer",
      reason: "vote_completed",
    });
  });

  it("вес «не выполнил» больше → донору 100% (vote_not_completed)", () => {
    expect(tally(disp([vote("a", "not_completed", 70), vote("b", "completed", 30)], 50))).toEqual({
      outcome: "to_donor",
      reason: "vote_not_completed",
    });
  });

  it("суммарный вес ниже кворума → стримеру (no_quorum)", () => {
    expect(tally(disp([vote("a", "not_completed", 10)], 100))).toMatchObject({
      reason: "no_quorum",
      outcome: "to_streamer",
    });
  });

  it("ничья по весу → стримеру (презумпция §11)", () => {
    expect(
      tally(disp([vote("a", "completed", 50), vote("b", "not_completed", 50)], 50)),
    ).toMatchObject({ reason: "tie", outcome: "to_streamer" });
  });
});

describe("разрешение по времени (dueResolution)", () => {
  it("PENDING после окна → возврат донору (expired)", () => {
    expect(dueResolution(newTask(), T0 + WINDOWS.accept + 1)).toMatchObject({
      reason: "expired",
      outcome: "to_donor",
    });
    expect(dueResolution(newTask(), T0 + 1)).toBeNull();
  });

  it("ACCEPTED после срока → no_show (возврат донору)", () => {
    const acc = accept(newTask(), T0);
    expect(dueResolution(acc, T0 + WINDOWS.executionDefault + 1)).toMatchObject({
      reason: "no_show",
    });
  });

  it("DONE после окна оспаривания без спора → стримеру (completed)", () => {
    const done = markDone(accept(newTask(), T0), TD);
    expect(dueResolution(done, TD + WINDOWS.disputeWindow + 1)).toMatchObject({
      reason: "completed",
      outcome: "to_streamer",
    });
  });
});

describe("эффекты на репутацию (ADR 0015)", () => {
  it("деньги стримеру → донор получает очки за дошедший донат", () => {
    const fx = repEffects(newTask(), { outcome: "to_streamer", reason: "completed" });
    expect(fx).toEqual([{ address: "Donor1", type: "DONATION", pointsDelta: 5, amount: AMOUNT }]);
  });

  it("возврат донору сам по себе очков не даёт", () => {
    expect(repEffects(newTask(), { outcome: "to_donor", reason: "expired" })).toEqual([]);
  });

  it("проигранный спор → списание инициатору; деньги стримеру → донор +очки", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const disp = raiseDispute(done, "Juror0", 1, TD + 1);
    const fx = repEffects(disp, { outcome: "to_streamer", reason: "vote_completed" });
    expect(fx).toContainEqual({
      address: "Juror0",
      type: "DISPUTE_LOST",
      pointsDelta: -DISPUTE_LOSS_PENALTY,
    });
    expect(fx).toContainEqual({
      address: "Donor1",
      type: "DONATION",
      pointsDelta: 5,
      amount: AMOUNT,
    });
  });

  it("подтверждённый спор (донору) → бонус инициатору, доната нет", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const disp = raiseDispute(done, "Juror0", 1, TD + 1);
    const fx = repEffects(disp, { outcome: "to_donor", reason: "vote_not_completed" });
    expect(fx).toEqual([
      { address: "Juror0", type: "DISPUTE_WON", pointsDelta: DISPUTE_WIN_BONUS },
    ]);
  });
});

describe("claim (ADR 0015)", () => {
  it("забрать может только получатель и только раз", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const resolved = {
      ...done,
      status: "RESOLVED" as const,
      resolution: {
        outcome: "to_streamer" as const,
        reason: "completed" as const,
        resolvedAt: "x",
        claimed: false,
      },
    };
    expect(throwsCode(() => claim(resolved, "Donor1", STREAMER, T0))).toBe("NOT_WINNER");
    const claimed = claim(resolved, STREAMER, STREAMER, T0);
    expect(claimed.resolution!.claimed).toBe(true);
    expect(throwsCode(() => claim(claimed, STREAMER, STREAMER, T0))).toBe("ALREADY_CLAIMED");
  });
});

describe("report (жалоба зрителя на текст задания)", () => {
  it("на своё задание жаловаться нельзя", () => {
    expect(throwsCode(() => report(newTask(), "Donor1", "спам", T0))).toBe("SELF_REPORT");
  });

  it("дедуп по reporter — второй раз тем же нельзя", () => {
    const t = report(newTask(), "Viewer1", "спам", T0);
    expect(t.reports).toHaveLength(1);
    expect(throwsCode(() => report(t, "Viewer1", "ещё", T0))).toBe("ALREADY_REPORTED");
  });

  it("порог REPORT_HIDE_THRESHOLD разных жалобщиков → авто-скрытие текста (деньги не трогаем)", () => {
    let t = newTask();
    for (let i = 0; i < REPORT_HIDE_THRESHOLD - 1; i++) t = report(t, `V${i}`, undefined, T0);
    expect(t.textState).not.toBe("HIDDEN");
    t = report(t, `V${REPORT_HIDE_THRESHOLD - 1}`, undefined, T0);
    expect(t.reports).toHaveLength(REPORT_HIDE_THRESHOLD);
    expect(t.textState).toBe("HIDDEN");
    expect(t.status).toBe("PENDING"); // жалоба на текст не двигает стадию/деньги
  });

  it("ESC-19: после accept жалобы НЕ гасят текст (деньги ⟹ текст на виду) — только копятся", () => {
    let t = accept(newTask(), T0); // ACCEPTED + SHOWN (деньги могут уйти стримеру)
    for (let i = 0; i < REPORT_HIDE_THRESHOLD + 1; i++) t = report(t, `V${i}`, undefined, T0);
    expect(t.reports).toHaveLength(REPORT_HIDE_THRESHOLD + 1); // жалобы фиксируются (сигнал оператору)
    expect(t.textState).toBe("SHOWN"); // но текст оплаченного задания не гаснет
  });
});

describe("hide (отказ стримера — скрыть без резолва/ончейна)", () => {
  it("ставит hidden; деньги/статус/резолюцию не трогает", () => {
    const t = hide(newTask());
    expect(t.hidden).toBe(true);
    expect(t.status).toBe("PENDING");
    expect(t.resolution).toBeUndefined();
  });
  it("на завершённом задании нельзя", () => {
    const resolved = reject(newTask(), T0 + 1); // RESOLVED to_donor
    expect(throwsCode(() => hide(resolved))).toBe("NOT_OPEN");
  });
  it("ESC-19: на ПРИНЯТОМ задании отклонить нельзя (деньги ⟹ задание на виду)", () => {
    expect(throwsCode(() => hide(accept(newTask(), T0)))).toBe("NOT_OPEN");
  });
});

describe("операторский тейкдаун (operatorBlocked) — перебивает публикацию", () => {
  it("isTextPublic=false даже если текст SHOWN (снято оператором платформы)", () => {
    const shown = { ...accept(newTask(), T0), textState: "SHOWN" as const };
    expect(isTextPublic(shown)).toBe(true);
    expect(isTextPublic({ ...shown, operatorBlocked: true })).toBe(false);
  });
});
