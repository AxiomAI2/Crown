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
  TaskReport,
  TaskVote,
} from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ⚠️ ВРЕМЕННО (тест ончейн-цикла): короткие окна, чтобы прогонять задание за минуты. ВЕРНУТЬ В ПРОД
// ОДНИМ ИЗМЕНЕНИЕМ — `FAST_TEST_WINDOWS = false`. ВАЖНО: ончейн-константы (ACCEPT_WINDOW/DISPUTE_WINDOW в
// anchor/programs/escrow-task/src/lib.rs) должны совпадать с этими — при возврате их тоже вернуть + редеплой.
const FAST_TEST_WINDOWS = true;

/** Окна процесса (спека §5/§10). Стартовые дефолты — калибруются на тестнете (спека §16). */
export const WINDOWS = FAST_TEST_WINDOWS
  ? {
      accept: 3 * MIN,
      grace: 1 * MIN,
      executionDefault: 2 * MIN,
      executionMin: 2 * MIN, // ESC-17: > grace, иначе окно mark_done (после грейса) вырождается
      executionMax: 90 * DAY,
      disputeWindow: 2 * MIN,
      voting: 2 * MIN,
    }
  : {
      accept: 72 * HOUR, // не принят за это время → возврат донору
      grace: 2 * MIN, // окно отмены донором после принятия
      executionDefault: 24 * HOUR,
      // ESC-17: минимальный срок сдачи ОБЯЗАН превышать грейс (иначе окно mark_done после грейса пустое/
      // вырожденное → гарантированный no-show). Держим заметный запас над grace (2 мин).
      executionMin: 5 * MIN,
      executionMax: 90 * DAY, // потолок срока выполнения — до 3 месяцев (донор вписывает число вручную)
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
  textState?: "SHOWN" | "HELD" | "HIDDEN"; // видимость текста в публичной ленте (решает обработчик по textShowMode)
  executionMs?: number; // предложенный донором срок выполнения (в пределах окна)
}

export function createTask(input: CreateTaskInput, nowMs: number): EscrowTask {
  // Срок СДАЧИ задаёт донор и он отсчитывается ОТ СОЗДАНИЯ (= ончейн done_deadline от `fund`). «Принять» —
  // бесплатная оффчейн-пометка, отдельного окна принятия и сброса срока нет (упрощение UX, см. переписку).
  // ESC-17: нижняя граница срока сдачи ОБЯЗАНА превышать грейс (паритет с ончейн require execution_window >
  // CANCEL_GRACE) — иначе окно mark_done (после грейса, ESC-13) пустое и задание всегда уходит в no-show.
  const proposed = clamp(
    input.executionMs ?? WINDOWS.executionDefault,
    Math.max(WINDOWS.executionMin, WINDOWS.grace + 1),
    WINDOWS.executionMax,
  );
  const deliverBy = iso(nowMs + proposed);
  return {
    id: input.id,
    channelId: input.channelId,
    donor: input.donor,
    amount: input.amount,
    text: input.text,
    createdAt: iso(nowMs),
    executionDeadline: deliverBy, // срок сдачи от создания (= ончейн done_deadline)
    // Грейс-окно отмены донора — ОТ СОЗДАНИЯ (= ончейн accept_deadline = fund + CANCEL_GRACE), как и проверка
    // в cancel/markDone. Задаётся один раз при создании, accept не сбрасывает.
    graceUntil: iso(nowMs + WINDOWS.grace),
    status: "PENDING",
    textState: input.textState, // undefined = SHOWN (совместимость)
  };
}

export function accept(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING")
    throw new GameBusError("NOT_PENDING", "Задание уже не ждёт ответа.");
  if (nowMs > ms(task.executionDeadline))
    throw new GameBusError("ACCEPT_EXPIRED", "Срок сдачи истёк — донат вернётся донору.");
  // ESC-19: принятие РАСКРЫВАЕТ текст (SHOWN). Ончейн `accept` обязателен перед `mark_done`, а по accept-tx
  // индексер раскроет текст и мимо UI — так «спрятал текст, но забрал деньги» невозможно (шов ончейн↔офчейн).
  return { ...task, status: "ACCEPTED", textState: "SHOWN" };
}

export function reject(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", "Отклонить можно только до «Готово».");
  return applyResolution(task, { outcome: "to_donor", reason: "rejected" }, nowMs);
}

export function cancel(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", "Отменить можно только до «Готово».");
  // Грейс-окно от создания (совпадает с ончейн accept_deadline = fund + CANCEL_GRACE; аудит #5) — чтобы
  // донор не обнулял уже сделанную работу отменой в любой момент.
  if (nowMs > ms(task.createdAt) + WINDOWS.grace)
    throw new GameBusError("GRACE_OVER", "Окно отмены закрыто.");
  return applyResolution(task, { outcome: "to_donor", reason: "canceled" }, nowMs);
}

export function markDone(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", "Отметить «Готово» можно только до разрешения.");
  // ESC-13: нельзя сдать в грейс-окне отмены донора (совпадает с ончейн accept_deadline = fund + grace) —
  // иначе стример фронт-раннит «Готово» сразу после fund и обнуляет аварийную отмену донора.
  if (nowMs <= ms(task.createdAt) + WINDOWS.grace)
    throw new GameBusError("GRACE_ACTIVE", "Сдать можно после грейс-окна отмены донора.");
  if (nowMs > ms(task.executionDeadline))
    throw new GameBusError("EXEC_OVER", "Срок сдачи истёк — донат вернётся донору (no-show).");
  // Пруфа нет: у контентмейкеров доказательство — сам стрим/VOD, комьюнити его и так мониторит. «Готово» —
  // просто декларация, открывающая окно оспаривания; не сделано → комьюнити поднимает спор.
  return {
    ...task,
    status: "DONE",
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
      return nowMs > ms(task.executionDeadline) ? { outcome: "to_donor", reason: "expired" } : null;
    case "ACCEPTED":
      return nowMs > ms(task.executionDeadline) ? { outcome: "to_donor", reason: "no_show" } : null;
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

// ───────────────────────── жалобы на текст задания ─────────────────────────

/** Порог авто-скрытия текста задания по жалобам (как у сообщений доната, mock-provider). */
export const REPORT_HIDE_THRESHOLD = 3;
const REASON_MAX = 500;

/**
 * Жалоба зрителя на текст задания. Дедуп по reporter; на своё задание жаловаться нельзя. При достижении
 * порога текст авто-скрывается (textState=HIDDEN) — деньги/эскроу НЕ трогаем (§7 «скрытие текста ≠ деньги»).
 */
export function report(
  task: EscrowTask,
  reporter: string,
  reason: string | undefined,
  nowMs: number,
): EscrowTask {
  if (reporter === task.donor)
    throw new GameBusError("SELF_REPORT", "На своё задание пожаловаться нельзя.");
  const reports = task.reports ?? [];
  if (reports.some((r) => r.reporter === reporter))
    throw new GameBusError("ALREADY_REPORTED", "Ты уже пожаловался на это задание.");
  const next: TaskReport[] = [
    ...reports,
    { reporter, reason: reason?.slice(0, REASON_MAX), ts: iso(nowMs) },
  ];
  return {
    ...task,
    reports: next,
    // Порог жалоб → авто-скрытие текста (HIDDEN). Ниже порога состояние не трогаем.
    textState: next.length >= REPORT_HIDE_THRESHOLD ? "HIDDEN" : task.textState,
  };
}

/** Стример показывает/скрывает текст задания в публичной ленте (модерация публикации; деньги/эскроу — §7). */
export function setTextState(task: EscrowTask, state: "SHOWN" | "HIDDEN"): EscrowTask {
  return { ...task, textState: state };
}

/**
 * Стример «отклоняет» задание: прячем из фронтенда БЕЗ ончейн-tx и без немедленного резолва — эскроу останется
 * и вернётся донору сам по таймеру (no-show/expired). Деньги/статус не трогаем; только для незавершённого.
 */
export function hide(task: EscrowTask): EscrowTask {
  if (task.status === "RESOLVED") throw new GameBusError("NOT_OPEN", "Задание уже завершено.");
  return { ...task, hidden: true };
}

/** Виден ли текст задания в ПУБЛИЧНОЙ ленте (без учёта роли смотрящего). Пусто = SHOWN (совместимость). */
export function isTextPublic(task: EscrowTask): boolean {
  return (task.textState ?? "SHOWN") === "SHOWN";
}
