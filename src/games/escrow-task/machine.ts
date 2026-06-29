/**
 * Стейт-машина «задание-донат» — ЧИСТАЯ логика (без IO/React), по спеке §5/§6/§11. Все функции
 * детерминированы: время приходит параметром `nowMs`, переходы возвращают НОВЫЙ объект (иммутабельно).
 *
 * Разделение ответственности: машина проверяет СТОЯНИЕ и ВРЕМЯ; авторизацию (владелец/донор/допуск
 * присяжного) и вычисление веса/кворума делает обработчик (game-bus, G1.3 part 2) — у него есть конфиг
 * канала и журнал. Эффекты на репутацию (ADR 0015) машина только ВЫЧИСЛЯЕТ; банкует их обработчик.
 */
import { pointsForAmount } from "@/lib/reputation";
import { GameBusError } from "../bus";
import type {
  EscrowTask,
  RepEffect,
  ResolutionReason,
  TaskDispute,
  TaskOutcome,
  TaskVote,
} from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Окна процесса (спека §5/§10). Стартовые дефолты — калибруются на тестнете (спека §16). */
export const WINDOWS = {
  accept: 72 * HOUR, // не принят за это время → возврат донору
  grace: 2 * MIN, // окно отмены донором после принятия
  executionDefault: 24 * HOUR,
  executionMin: 1 * HOUR,
  executionMax: 7 * DAY,
  disputeWindow: 12 * HOUR, // от «Готово» — окно поднять спор
  voting: 24 * HOUR,
};

/** Изменение репутации за спор (спека §8/§16: калибровка так, чтобы clawback был EV-отрицателен). */
export const DISPUTE_WIN_BONUS = 10; // подтверждённый спор (поднял, комьюнити согласилось)
export const DISPUTE_LOSS_PENALTY = 50; // проигранный спор (списание инициатору)

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (isoStr: string) => Date.parse(isoStr);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────────────────────── переходы (действия) ─────────────────────────

export interface CreateTaskInput {
  id: string;
  channelId: string;
  donor: string;
  amount: string; // micro-USDC строкой
  text: string;
  executionMs?: number; // предложенный донором срок выполнения (в пределах окна)
}

export function createTask(input: CreateTaskInput, nowMs: number): EscrowTask {
  // Срок выполнения предлагает донор (в пределах коридора); применяется при принятии (отсчёт от accept).
  const proposed = clamp(
    input.executionMs ?? WINDOWS.executionDefault,
    WINDOWS.executionMin,
    WINDOWS.executionMax,
  );
  return {
    id: input.id,
    channelId: input.channelId,
    donor: input.donor,
    amount: input.amount,
    text: input.text,
    proposedExecutionMs: proposed,
    createdAt: iso(nowMs),
    acceptDeadline: iso(nowMs + WINDOWS.accept),
    status: "PENDING",
  };
}

export function accept(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING")
    throw new GameBusError("NOT_PENDING", "Задание уже не ждёт ответа.");
  if (nowMs > ms(task.acceptDeadline))
    throw new GameBusError("ACCEPT_EXPIRED", "Срок принятия истёк — донат вернётся донору.");
  return {
    ...task,
    status: "ACCEPTED",
    acceptedAt: iso(nowMs),
    graceUntil: iso(nowMs + WINDOWS.grace),
    executionDeadline: iso(nowMs + task.proposedExecutionMs),
  };
}

export function reject(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING")
    throw new GameBusError("NOT_PENDING", "Отклонить можно только ожидающее задание.");
  return applyResolution(task, { outcome: "to_donor", reason: "rejected" }, nowMs);
}

export function cancel(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "ACCEPTED")
    throw new GameBusError("NOT_ACCEPTED", "Отмена доступна только сразу после принятия.");
  if (nowMs > ms(task.graceUntil ?? task.createdAt))
    throw new GameBusError("GRACE_OVER", "Окно отмены закрыто.");
  return applyResolution(task, { outcome: "to_donor", reason: "canceled" }, nowMs);
}

export function markDone(task: EscrowTask, proofUrl: string, nowMs: number): EscrowTask {
  if (task.status !== "ACCEPTED")
    throw new GameBusError("NOT_ACCEPTED", "Отметить «Готово» можно только принятое задание.");
  if (nowMs > ms(task.executionDeadline ?? task.createdAt))
    throw new GameBusError("EXEC_OVER", "Срок выполнения истёк — донат вернётся донору (no-show).");
  if (!proofUrl.trim()) throw new GameBusError("NO_PROOF", "Нужна ссылка-пруф (VOD/клип).");
  return {
    ...task,
    status: "DONE",
    doneAt: iso(nowMs),
    proofUrl: proofUrl.trim(),
    disputeWindowEndsAt: iso(nowMs + WINDOWS.disputeWindow),
  };
}

export function raiseDispute(
  task: EscrowTask,
  by: string,
  quorum: number,
  nowMs: number,
): EscrowTask {
  if (task.status !== "DONE")
    throw new GameBusError("NOT_DONE", "Спор можно поднять только после «Готово».");
  if (nowMs > ms(task.disputeWindowEndsAt ?? task.createdAt))
    throw new GameBusError("DISPUTE_WINDOW_OVER", "Окно оспаривания закрыто.");
  const dispute: TaskDispute = {
    by,
    openedAt: iso(nowMs),
    votingEndsAt: iso(nowMs + WINDOWS.voting),
    quorum,
    votes: [],
  };
  return { ...task, status: "DISPUTED", dispute };
}

export function castVote(task: EscrowTask, vote: TaskVote, nowMs: number): EscrowTask {
  if (task.status !== "DISPUTED" || !task.dispute)
    throw new GameBusError("NOT_DISPUTED", "Голосовать можно только в активном споре.");
  if (nowMs > ms(task.dispute.votingEndsAt))
    throw new GameBusError("VOTING_OVER", "Голосование завершено.");
  if (task.dispute.votes.some((v) => v.voter === vote.voter))
    throw new GameBusError("ALREADY_VOTED", "Ты уже голосовал в этом споре.");
  return { ...task, dispute: { ...task.dispute, votes: [...task.dispute.votes, vote] } };
}

// ───────────────────────── разрешение (время + голоса) ─────────────────────────

/** Итог голосования по весу. Кворум — в очках репутации; ничья/нет кворума → стримеру (презумпция §11). */
export function tally(d: TaskDispute): { outcome: TaskOutcome; reason: ResolutionReason } {
  let completed = 0;
  let not = 0;
  for (const v of d.votes) {
    if (v.choice === "completed") completed += v.weight;
    else not += v.weight;
  }
  if (completed + not < d.quorum) return { outcome: "to_streamer", reason: "no_quorum" };
  if (completed > not) return { outcome: "to_streamer", reason: "vote_completed" };
  if (not > completed) return { outcome: "to_donor", reason: "vote_not_completed" };
  return { outcome: "to_streamer", reason: "tie" };
}

/** Терминальный исход, наступивший ПО ВРЕМЕНИ (или по завершении голосования). null — ещё рано. */
export function dueResolution(
  task: EscrowTask,
  nowMs: number,
): { outcome: TaskOutcome; reason: ResolutionReason } | null {
  switch (task.status) {
    case "PENDING":
      return nowMs > ms(task.acceptDeadline) ? { outcome: "to_donor", reason: "expired" } : null;
    case "ACCEPTED":
      return task.executionDeadline && nowMs > ms(task.executionDeadline)
        ? { outcome: "to_donor", reason: "no_show" }
        : null;
    case "DONE":
      return task.disputeWindowEndsAt && nowMs > ms(task.disputeWindowEndsAt)
        ? { outcome: "to_streamer", reason: "completed" }
        : null;
    case "DISPUTED":
      return task.dispute && nowMs > ms(task.dispute.votingEndsAt) ? tally(task.dispute) : null;
    default:
      return null;
  }
}

export function applyResolution(
  task: EscrowTask,
  res: { outcome: TaskOutcome; reason: ResolutionReason },
  nowMs: number,
): EscrowTask {
  return {
    ...task,
    status: "RESOLVED",
    resolution: {
      outcome: res.outcome,
      reason: res.reason,
      resolvedAt: iso(nowMs),
      claimed: false,
    },
  };
}

/**
 * Эффекты на репутацию по разрешению (ADR 0015, спека §8):
 *  - деньги дошли стримеру → донор получает статус за дошедший донат (DONATION, +);
 *  - проигранный спор → списание инициатору (DISPUTE_LOST, −);
 *  - подтверждённый спор → бонус инициатору (DISPUTE_WON, +).
 * Возврат донору сам по себе репутации не даёт (спека §8).
 */
export function repEffects(
  task: EscrowTask,
  res: { outcome: TaskOutcome; reason: ResolutionReason },
): RepEffect[] {
  const out: RepEffect[] = [];
  if (res.outcome === "to_streamer") {
    out.push({
      address: task.donor,
      type: "DONATION",
      pointsDelta: pointsForAmount(BigInt(task.amount)),
      amount: task.amount,
    });
  }
  if (task.dispute) {
    if (res.reason === "vote_completed")
      out.push({
        address: task.dispute.by,
        type: "DISPUTE_LOST",
        pointsDelta: -DISPUTE_LOSS_PENALTY,
      });
    if (res.reason === "vote_not_completed")
      out.push({ address: task.dispute.by, type: "DISPUTE_WON", pointsDelta: DISPUTE_WIN_BONUS });
  }
  return out;
}

// ───────────────────────── claim (ADR 0015) ─────────────────────────

/** Забрать деньги из эскроу. Получатель = стример (to_streamer) или донор (to_donor); только он, один раз. */
export function claim(
  task: EscrowTask,
  by: string,
  streamerAddress: string,
  nowMs: number,
): EscrowTask {
  void nowMs; // в claim-модели время не двигает состояние, но держим единую сигнатуру переходов
  if (task.status !== "RESOLVED" || !task.resolution)
    throw new GameBusError("NOT_RESOLVED", "Забирать пока нечего — задание не разрешено.");
  if (task.resolution.claimed) throw new GameBusError("ALREADY_CLAIMED", "Уже забрано.");
  const winner = task.resolution.outcome === "to_streamer" ? streamerAddress : task.donor;
  if (by !== winner) throw new GameBusError("NOT_WINNER", "Забрать может только получатель.");
  return { ...task, resolution: { ...task.resolution, claimed: true } };
}
