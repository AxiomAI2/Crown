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
import type { EscrowTask, ResolutionReason, TaskOutcome, VoteChoice } from "./types";

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

/**
 * Свести офчейн-исход (по времени/голосам) с ОНЧЕЙН-исходом эскроу (ESC-12, деньги = истина). Если цепочка
 * расходится с офчейн-таймером (напр. резолвер не успел до дедлайна → resolve_timeout отдал стримеру),
 * берём ончейн-сторону и синтезируем когерентный reason, чтобы спор-эффекты следовали за деньгами.
 */
function reconcile(
  due: { outcome: TaskOutcome; reason: ResolutionReason },
  chain: "to_streamer" | "to_donor",
  task: EscrowTask,
): { outcome: TaskOutcome; reason: ResolutionReason } {
  if (chain === due.outcome) return due;
  return chain === "to_streamer"
    ? { outcome: "to_streamer", reason: task.dispute ? "vote_completed" : "completed" }
    : { outcome: "to_donor", reason: task.dispute ? "vote_not_completed" : "expired" };
}

/**
 * Разрешить по времени и забанковать эффекты, если пора (один раз — потом статус RESOLVED).
 * ESC-12: для chain-backed задания (есть `escrowTaskId`) банкуем донат-репутацию только когда исход
 * ПОДТВЕРЖДЁН на цепочке — деньги истина, не офчейн-таймер. Эскроу ещё не разрешён на цепочке → откладываем.
 */
async function settle(ctx: GameContext, task: EscrowTask): Promise<EscrowTask> {
  if (task.status === "RESOLVED") return task;
  const due = M.dueResolution(task, nowMs(ctx));
  if (!due) return task;
  if (task.escrowTaskId && ctx.escrowOutcome) {
    // M3 (закрывает хвост ESC-12/16): банкуем ТОЛЬКО при ИЗВЕСТНОМ ончейн-исходе — живая `resolution` ИЛИ
    // зафиксированный event-индексером claim (истина денег переживает закрытие аккаунта). Исход неизвестен
    // (Unresolved / не проиндексирован / сбой RPC) → ОТКЛАДЫВАЕМ. Офчейн-таймера для chain-backed задания нет.
    const outcome = await ctx.escrowOutcome(task.escrowTaskId);
    if (!outcome) return task;
    const res = reconcile(due, outcome, task);
    const resolved = M.applyResolution(task, res, nowMs(ctx));
    ctx.bankLedger(M.repEffects(resolved, res));
    return resolved;
  }
  const resolved = M.applyResolution(task, due, nowMs(ctx));
  ctx.bankLedger(M.repEffects(resolved, due));
  return resolved;
}

/**
 * ESC-19: раскрыть текст задания, если стример ПРИНЯЛ его на цепочке (даже в обход UI). Путь к деньгам
 * стримеру (accept→mark_done→claim) невозможен без ончейн-`accept`, а `accept` мы видим через индексер и
 * раскрываем текст комьюнити. Так «спрятал текст, но забрал деньги» исключено. Только для chain-backed
 * заданий; state≥Accepted (или уже ушло стримеру) → SHOWN. Деньги/резолв не трогаем.
 */
async function revealFromChain(ctx: GameContext, task: EscrowTask): Promise<EscrowTask> {
  if ((task.textState ?? "SHOWN") === "SHOWN" || !task.escrowTaskId) return task;
  if (ctx.escrowState) {
    const st = await ctx.escrowState(task.escrowTaskId);
    // Accepted(1)/Done(2)/Disputed(4) ⟹ accept ончейн был (mark_done требует Accepted) → раскрываем текст.
    if (st === 1 || st === 2 || st === 4)
      return {
        ...task,
        textState: "SHOWN",
        status: task.status === "PENDING" ? "ACCEPTED" : task.status,
      };
  }
  // Эскроу закрыт claim'ом стримеру ⟹ прошёл через Done ⟹ accept был → раскрываем ретроспективно (страховка
  // на случай, если индексер не успел до закрытия аккаунта).
  if (ctx.escrowOutcome && (await ctx.escrowOutcome(task.escrowTaskId)) === "to_streamer")
    return { ...task, textState: "SHOWN" };
  return task;
}

export const escrowTaskHandlers: GameHandlers = {
  actions: {
    // Донор создаёт задание-донат (деньги «в эскроу» — мок).
    create: async (ctx, payload) => {
      const donor = requireIdentity(ctx);
      const p = (payload ?? {}) as {
        amount?: unknown;
        text?: unknown;
        executionMs?: unknown;
        escrowTaskId?: unknown; // chain-режим: ссылка на ончейн-эскроу (ADR 0017)
        fundTx?: unknown;
      };
      const amount = String(p.amount ?? "");
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n)
        throw new GameBusError("BAD_AMOUNT", "Нужна положительная сумма (micro-USDC).");
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new GameBusError("NO_TEXT", "Нужен текст задания.");
      // Модерация текста задания: нелегальное/опасное не создаётся вовсе. Иначе видимость текста в ПУБЛИЧНОЙ
      // ленте решаем той же политикой, что донат-сообщения (textShowMode): чистый + auto_if_clean → сразу
      // SHOWN; иначе → HELD (очередь модерации стримера до «Показать»). Деньги/эскроу от этого не зависят (§7).
      const verdict = await ctx.moderate(text);
      if (verdict === "HARD_BLOCK")
        throw new GameBusError(
          "ILLEGAL_TASK",
          "Задание не прошло модерацию: запрещён нелегальный/опасный контент.",
        );
      const textState: "SHOWN" | "HELD" =
        ctx.textShowMode === "auto_if_clean" && verdict === "CLEAR" ? "SHOWN" : "HELD";
      // Трастлесс-сверка ончейн-эскроу (chain-режим): задание без подтверждённого эскроу (нет аккаунта,
      // чужой донор/сумма/mint) не записываем — сервер не верит клиенту (ADR 0017). В mock/api — всегда ок.
      const escrowTaskId = typeof p.escrowTaskId === "string" ? p.escrowTaskId : undefined;
      // ESC-18: один ончейн-эскроу = одно зеркало. Повторная привязка того же escrowTaskId насчитала бы
      // репутацию N раз за ОДИН платёж (verifyEscrow пропускает дубль, пока эскроу в Pending) → инфляция §4.4.
      if (escrowTaskId && loadTasks(ctx).some((t) => t.escrowTaskId === escrowTaskId))
        throw new GameBusError("ESCROW_REUSED", "Этот эскроу уже привязан к заданию.");
      // ESC-6: вяжем эскроу к payout-адресу ИМЕННО этого канала (streamer) + требуем свежий Pending.
      // fail-closed: chain-эскроу без payout канала не привязываем (иначе streamer-сверка молча пропущена).
      const streamer = ctx.channelPayout ?? undefined;
      if (escrowTaskId && !streamer)
        throw new GameBusError("NO_PAYOUT", "У канала нет payout-адреса — эскроу нельзя привязать.");
      if (escrowTaskId && !(await ctx.verifyEscrow(escrowTaskId, { donor, amount, streamer }))) {
        throw new GameBusError(
          "ESCROW_INVALID",
          "Ончейн-эскроу не найден или не совпадает (донор/сумма/mint/канал).",
        );
      }
      const task = M.createTask(
        {
          // id используется в URL страницы спора → делаем URL-безопасным (id стора несёт ISO с «:»/«.»).
          id: ctx.newId().replace(/[^a-zA-Z0-9_-]/g, ""),
          channelId: ctx.channelId,
          donor,
          amount,
          text,
          textState,
          executionMs: typeof p.executionMs === "number" ? p.executionMs : undefined,
        },
        nowMs(ctx),
      );
      // chain-режим: привязываем оффчейн-зеркало к ончейн-эскроу (провайдер уже отправил `fund`).
      const stored: typeof task = {
        ...task,
        ...(escrowTaskId ? { escrowTaskId } : {}),
        ...(typeof p.fundTx === "string" ? { fundTx: p.fundTx } : {}),
      };
      saveTasks(ctx, [...loadTasks(ctx), stored]);
      return stored;
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

    // Стример «Отклонить»: прячем задание из фронтенда БЕЗ ончейн-tx и немедленного возврата. Эскроу вернётся
    // донору сам по таймеру (no-show) — стример не платит газ. Оффчейн-only (в chain-провайдере уходит в
    // default → api, транзакция не строится).
    hide: (ctx, payload) => {
      requireOwner(ctx);
      const tasks = loadTasks(ctx);
      return commit(ctx, tasks, M.hide(findTask(tasks, idOf(payload), ctx.channelId)));
    },

    // Зритель: жалоба на текст задания (публичный UGC). Дедуп/порог/авто-скрытие текста — в машине; деньги
    // и эскроу не трогаем (§7). Возвращаем {reports,hidden} — как reportMessage, чтобы UI дал тот же тост.
    report: (ctx, payload) => {
      const reporter = requireIdentity(ctx);
      const p = (payload ?? {}) as { reason?: unknown };
      const reason = typeof p.reason === "string" ? p.reason : undefined;
      const tasks = loadTasks(ctx);
      const updated = M.report(
        findTask(tasks, idOf(payload), ctx.channelId),
        reporter,
        reason,
        nowMs(ctx),
      );
      commit(ctx, tasks, updated);
      return { reports: updated.reports?.length ?? 0, hidden: updated.textState === "HIDDEN" };
    },

    // Стример: показать/скрыть текст задания в ПУБЛИЧНОЙ ленте (очередь модерации). Деньги/эскроу — не трогаем (§7).
    setTextState: (ctx, payload) => {
      requireOwner(ctx);
      const p = (payload ?? {}) as { state?: unknown };
      const state = p.state === "SHOWN" ? "SHOWN" : "HIDDEN";
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      // «Показать» можно только пока задание живо: таймер не истёк и оно не разрешено. Истекло → уходит в
      // возврат донору сам, публиковать текст поздно. «Скрыть» доступно всегда (ретракт).
      if (state === "SHOWN" && (task.status === "RESOLVED" || M.dueResolution(task, nowMs(ctx))))
        throw new GameBusError("TEXT_LOCKED", "Срок задания истёк — текст уже нельзя показать.");
      return commit(ctx, tasks, M.setTextState(task, state));
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
    claim: async (ctx, payload) => {
      const by = requireIdentity(ctx);
      const tasks = loadTasks(ctx);
      const task = findTask(tasks, idOf(payload), ctx.channelId);
      const settled = await settle(ctx, task);
      // ESC-14: ПЕРСИСТИМ резолв (со всеми забанкованными эффектами) ДО проверки победителя. Иначе M.claim
      // бросает NOT_WINNER до commit → статус не сохранён, а банковка (сайд-эффект settle) уже прошла →
      // повторный claim неполучателем снова видит задание дозревшим и чеканит репутацию без предела.
      if (settled !== task) commit(ctx, tasks, settled);
      return commit(ctx, loadTasks(ctx), M.claim(settled, by, ctx.channelOwner ?? "", nowMs(ctx)));
    },

    // PERMISSIONLESS: разрешить по времени + забанковать репутацию для ВСЕХ дозревших заданий канала, не
    // дожидаясь claim (ADR 0015 §2 — репутация в момент резолва). Зовётся фоновым сеттлером (indexer-service)
    // независимо от браузера. Идемпотентно: settle() не трогает уже RESOLVED. Деньги не двигает (claim-модель).
    settleDue: async (ctx) => {
      const tasks = loadTasks(ctx);
      let changed = 0;
      const next: EscrowTask[] = [];
      for (const t of tasks) {
        if (t.status === "RESOLVED" || t.channelId !== ctx.channelId) {
          next.push(t);
          continue;
        }
        // ESC-19: раскрыть текст, если стример принял ончейн (даже мимо UI), ДО попытки резолва.
        const revealed = await revealFromChain(ctx, t);
        const s = await settle(ctx, revealed); // банкует эффекты при переходе в RESOLVED (bankLedger)
        if (s !== t) changed++;
        next.push(s);
      }
      if (changed > 0) saveTasks(ctx, next);
      return { settled: changed };
    },
  },

  queries: {
    // Задания этого канала (сырые; «ожидаемый исход» по времени UI считает машиной сам).
    list: (ctx) => ({ tasks: loadTasks(ctx).filter((t) => t.channelId === ctx.channelId) }),
    get: (ctx, payload) => {
      const id = idOf(payload);
      return loadTasks(ctx).find((t) => t.id === id && t.channelId === ctx.channelId) ?? null;
    },
    // Голоса спора — ПОСТРАНИЧНО + фильтр по стороне + поиск по адресу + сортировка. Так страница спора
    // масштабируется на тысячи голосующих (не грузим всё разом). Агрегат (tally) считается по ВСЕМ голосам.
    disputeVotes: (ctx, payload) => {
      const p = (payload ?? {}) as {
        taskId?: unknown;
        page?: unknown;
        pageSize?: unknown;
        side?: unknown;
        sort?: unknown;
        q?: unknown;
      };
      const task = loadTasks(ctx).find((t) => t.id === p.taskId && t.channelId === ctx.channelId);
      if (!task || !task.dispute) return { found: false };
      const d = task.dispute;

      let completed = 0;
      let not = 0;
      let completedVotes = 0;
      let notVotes = 0;
      for (const v of d.votes) {
        if (v.choice === "completed") {
          completed += v.weight;
          completedVotes += 1;
        } else {
          not += v.weight;
          notVotes += 1;
        }
      }

      const q = typeof p.q === "string" ? p.q.trim().toLowerCase() : "";
      const side = p.side === "completed" || p.side === "not_completed" ? p.side : null;
      const sort = p.sort === "recent" ? "recent" : "weight";
      const filtered = d.votes
        .filter((v) => (!side || v.choice === side) && (!q || v.voter.toLowerCase().includes(q)))
        .sort((a, b) => (sort === "recent" ? (a.at < b.at ? 1 : -1) : b.weight - a.weight));

      const total = filtered.length;
      const page = Math.max(0, Math.floor(Number(p.page) || 0));
      const pageSize = Math.min(200, Math.max(1, Math.floor(Number(p.pageSize) || 50)));
      const votes = filtered.slice(page * pageSize, page * pageSize + pageSize);

      return {
        found: true,
        task: {
          id: task.id,
          status: task.status,
          amount: task.amount,
          text: task.text,
          donor: task.donor,
          resolution: task.resolution ?? null,
        },
        dispute: {
          by: d.by,
          openedAt: d.openedAt,
          votingEndsAt: d.votingEndsAt,
          quorum: d.quorum,
          tally: { completed, not, completedVotes, notVotes, total: completed + not },
        },
        votes,
        total,
        page,
        pageSize,
      };
    },
  },
};

function idOf(payload: unknown): unknown {
  return (payload as { taskId?: unknown } | null)?.taskId;
}
