/**
 * Обработчики мини-игры «задание-донат» для game-bus (ADR 0016). Склеивают чистую машину (machine.ts) с
 * контекстом провайдера: проверяют ЛИЧНОСТЬ/допуск (что машине не видно), считают вес голоса и кворум через
 * ядровые мостики, банкуют эффекты на репутацию (ADR 0015). Деньги — мок (claim лишь помечает забранным);
 * реальный эскроу — G3.
 *
 * Разрешение по времени и банковка происходят в `claim` (она в MUTATING → персистится): получатель забирает
 * выигрыш/возврат, и в этот момент исход фиксируется в журнале. Чтения (queries) — чистые, состояние не
 * меняют (UI выводит «ожидаемый исход» из машины сам).
 */
import { pointsForAmount } from "@/lib/reputation";
import { GameBusError, type GameContext, type GameHandlers } from "../bus";
import * as M from "./machine";
import type { EscrowTask, VoteChoice } from "./types";

/** Минимальная репутация, чтобы поднять спор (спека §10 — рычаг стримера; для мока — константа, калибровка). */
const DISPUTE_MIN_REP = 1;
/** Кворум в очках репутации — растёт с суммой доната (спека §8). Мок-дефолт: не меньше очков самого доната. */
const quorumFor = (amount: string) => Math.max(1, pointsForAmount(BigInt(amount)));

const nowMs = (ctx: GameContext) => Date.parse(ctx.now());

interface EscrowState {
  tasks: EscrowTask[];
}
const loadTasks = (ctx: GameContext): EscrowTask[] => ctx.state.get<EscrowState>()?.tasks ?? [];
const saveTasks = (ctx: GameContext, tasks: EscrowTask[]) =>
  ctx.state.set({ tasks } satisfies EscrowState);

function findTask(tasks: EscrowTask[], id: unknown, channelId: string): EscrowTask {
  const t =
    typeof id === "string"
      ? tasks.find((x) => x.id === id && x.channelId === channelId)
      : undefined;
  if (!t) throw new GameBusError("NO_TASK", "Задание не найдено.");
  return t;
}
/** Заменить задание в списке по id и сохранить; вернуть его. */
function commit(ctx: GameContext, tasks: EscrowTask[], updated: EscrowTask): EscrowTask {
  saveTasks(
    ctx,
    tasks.map((t) => (t.id === updated.id ? updated : t)),
  );
  return updated;
}

function requireIdentity(ctx: GameContext): string {
  if (!ctx.identity) throw new GameBusError("NO_SESSION", "Сначала войди кошельком.");
  return ctx.identity;
}
function requireOwner(ctx: GameContext): string {
  const id = requireIdentity(ctx);
  if (id !== ctx.channelOwner)
    throw new GameBusError("FORBIDDEN", "Действие доступно только владельцу канала.");
  return id;
}

/** Разрешить по времени и забанковать эффекты, если пора (один раз — потом статус RESOLVED). */
function settle(ctx: GameContext, task: EscrowTask): EscrowTask {
  if (task.status === "RESOLVED") return task;
  const due = M.dueResolution(task, nowMs(ctx));
  if (!due) return task;
  const resolved = M.applyResolution(task, due, nowMs(ctx));
  ctx.bankLedger(M.repEffects(resolved, due));
  return resolved;
}

export const escrowTaskHandlers: GameHandlers = {
  actions: {
    // Донор создаёт задание-донат (деньги «в эскроу» — мок).
    create: (ctx, payload) => {
      const donor = requireIdentity(ctx);
      const p = (payload ?? {}) as { amount?: unknown; text?: unknown; executionMs?: unknown };
      const amount = String(p.amount ?? "");
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n)
        throw new GameBusError("BAD_AMOUNT", "Нужна положительная сумма (micro-USDC).");
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new GameBusError("NO_TEXT", "Нужен текст задания.");
      const task = M.createTask(
        {
          id: ctx.newId(),
          channelId: ctx.channelId,
          donor,
          amount,
          text,
          executionMs: typeof p.executionMs === "number" ? p.executionMs : undefined,
        },
        nowMs(ctx),
      );
      saveTasks(ctx, [...loadTasks(ctx), task]);
      return task;
    },

    // Стример: принять / отклонить / отметить «Готово».
    accept: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.accept(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },
    reject: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.reject(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },
    markDone: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(
        ctx,
        tasks,
        M.markDone(findTask(tasks, idOf(payload), ctx.channelId), nowMs(ctx)),
      );
    },

    // Донор: отмена в грейс-окне.
    cancel: (ctx, payload) => {
      const id = requireIdentity(ctx);
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      if (id !== task.donor) throw new GameBusError("FORBIDDEN", "Отменить может только донор.");
      return commit(ctx, tasks, M.cancel(task, nowMs(ctx)));
    },

    // Квалифицированный зритель поднимает спор (не стример; репутация ≥ порога).
    raiseDispute: (ctx, payload) => {
      const id = requireIdentity(ctx);
      if (id === ctx.channelOwner)
        throw new GameBusError("FORBIDDEN", "Стример не оспаривает своё выполнение.");
      if (ctx.reputationAsOf(id, ctx.now()) < DISPUTE_MIN_REP)
        throw new GameBusError("LOW_REP", "Недостаточно репутации, чтобы поднять спор.");
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      return commit(ctx, tasks, M.raiseDispute(task, id, quorumFor(task.amount), nowMs(ctx)));
    },

    // Присяжный голосует; вес = репутация на снэпшоте (момент поднятия спора). Донор/стример исключены.
    vote: (ctx, payload) => {
      const id = requireIdentity(ctx);
      const p = (payload ?? {}) as { taskId?: unknown; choice?: unknown };
      const choice =
        p.choice === "completed" || p.choice === "not_completed" ? (p.choice as VoteChoice) : null;
      if (!choice) throw new GameBusError("BAD_CHOICE", "Выбор: completed | not_completed.");
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, p.taskId, ctx.channelId);
      if (id === task.donor)
        throw new GameBusError("FORBIDDEN", "Донор не голосует в своём споре.");
      if (id === ctx.channelOwner)
        throw new GameBusError("FORBIDDEN", "Стример не голосует в своём споре.");
      const weight = ctx.reputationAsOf(id, task.dispute?.openedAt ?? ctx.now());
      return commit(
        ctx,
        tasks,
        M.castVote(task, { voter: id, choice, weight, at: ctx.now() }, nowMs(ctx)),
      );
    },

    // Получатель забирает деньги (claim-модель, ADR 0015): тут же разрешаем по времени + банкуем эффекты.
    claim: (ctx, payload) => {
      const by = requireIdentity(ctx);
      const tasks = loadTasks(ctx);
      const settled = settle(ctx, findTask(tasks, idOf(payload), ctx.channelId));
      return commit(ctx, tasks, M.claim(settled, by, ctx.channelOwner ?? "", nowMs(ctx)));
    },
  },

  queries: {
    // Задания этого канала (сырые; «ожидаемый исход» по времени UI считает машиной сам).
    list: (ctx) => ({ tasks: loadTasks(ctx).filter((t) => t.channelId === ctx.channelId) }),
    get: (ctx, payload) => {
      const id = idOf(payload);
      return loadTasks(ctx).find((t) => t.id === id && t.channelId === ctx.channelId) ?? null;
    },
  },
};

function idOf(payload: unknown): unknown {
  return (payload as { taskId?: unknown } | null)?.taskId;
}
