"use client";

import Link from "next/link";
import { useState } from "react";
import { Amount } from "@/components/domain/amount";
import { StandingHeadline } from "@/components/domain/standing";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useChannelConfig, useSession, useStanding } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { toMicro } from "@/lib/utils";
import { useEscrowAction, useEscrowTasks } from "./hooks";
import { dueResolution, WINDOWS } from "./machine";
import type { EscrowTask, TaskDispute } from "./types";

// Те же пресеты сумм, что и в обычном донате (донат-виджет) — единый дизайн.
const PRESETS = [5, 10, 25, 100];

// Срок на выполнение донор вписывает вручную (число + единица), от 1 минуты до 3 месяцев (см. WINDOWS).
const H = 3_600_000;
const MIN = H / 60;
const DAY = 24 * H;
const UNIT_MS: Record<"m" | "h" | "d", number> = { m: MIN, h: H, d: DAY };

/** Человеческое «осталось …» до момента iso (для таймера дедлайна на карточке). */
function until(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "срок истёк";
  const h = Math.floor(ms / H);
  if (h >= 24) return `осталось ~${Math.floor(h / 24)} дн`;
  if (h >= 1) return `осталось ~${h} ч`;
  return `осталось ~${Math.max(1, Math.floor(ms / 60_000))} мин`;
}

/** Какой дедлайн сейчас тикает (по стадии) — подпись для карточки. */
function deadlineLabel(task: EscrowTask): string | null {
  switch (task.status) {
    case "PENDING":
      return `Принять до · ${until(task.acceptDeadline)}`;
    case "ACCEPTED":
      return task.executionDeadline ? `Выполнить · ${until(task.executionDeadline)}` : null;
    case "DONE":
      return task.disputeWindowEndsAt ? `Оспорить до · ${until(task.disputeWindowEndsAt)}` : null;
    case "DISPUTED":
      return task.dispute ? `Голосование · ${until(task.dispute.votingEndsAt)}` : null;
    default:
      return null;
  }
}

/**
 * UI мини-игры «задание-донат», две поверхности (ADR 0016 / редизайн раздела игр на канале):
 *  - EscrowTaskRail — ПРАВЫЙ рейл: действие (создать задание-донат);
 *  - EscrowTaskHub  — ЛЕВО: правила + «почему честно» + активные задания (мониторинг, споры).
 * Данные — через типизированные хуки (game-bus). Деньги пока мок; реальный эскроу — G3.
 */

interface GameProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

const STATUS_LABEL: Record<EscrowTask["status"], string> = {
  PENDING: "Ждёт стримера",
  ACCEPTED: "В работе",
  DONE: "Окно оспаривания",
  DISPUTED: "Голосование по спору",
  RESOLVED: "Завершено",
};
const outcomeLabel = (o: "to_streamer" | "to_donor") =>
  o === "to_streamer" ? "стримеру" : "возврат донору";

type Run = (op: string, payload?: unknown, okMsg?: string) => void;

function useRun(channelId: string): { run: Run; pending: boolean } {
  const action = useEscrowAction(channelId);
  const run: Run = (op, payload, okMsg) =>
    action.mutate(
      { op, payload },
      {
        onSuccess: () => okMsg && toast({ variant: "success", title: okMsg }),
        onError: (e) =>
          toast({
            variant: "error",
            title: "Не получилось",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  return { run, pending: action.isPending };
}

// ───────────────────────── правый рейл: действие ─────────────────────────

export function EscrowTaskRail({ channelId }: GameProps) {
  const viewer = useSession().data?.address ?? null;
  const config = useChannelConfig(channelId).data;
  const standingQ = useStanding(channelId, viewer);
  const { run, pending } = useRun(channelId);
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  // Срок выполнения задаёт донор вручную: число + единица (часы/дни). По умолчанию — 1 день.
  const [dlValue, setDlValue] = useState("1");
  const [dlUnit, setDlUnit] = useState<"m" | "h" | "d">("d");

  const num = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(num) && num > 0;
  const gain = amountValid ? pointsForAmount(toMicro(num)) : 0; // предпросмотр прибавки очков

  const dlNum = Number(dlValue);
  const deadlineMs = dlNum * UNIT_MS[dlUnit];
  const deadlineValid =
    dlValue !== "" &&
    Number.isInteger(dlNum) &&
    deadlineMs >= WINDOWS.executionMin &&
    deadlineMs <= WINDOWS.executionMax;
  const deadlineError =
    dlValue !== "" && !deadlineValid ? "Срок: от 1 минуты до 3 месяцев" : undefined;
  const valid = amountValid && text.trim().length > 0 && deadlineValid;

  function create() {
    if (!valid) return;
    run(
      "create",
      { amount: toMicro(num).toString(), text: text.trim(), executionMs: deadlineMs },
      "Задание создано",
    );
    setAmount("");
    setText("");
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
      {!viewer ? (
        <>
          <h3 className="text-h3 text-fg">Задание-донат</h3>
          <p className="text-small text-fg-muted">Подключи кошелёк, чтобы создать задание.</p>
        </>
      ) : (
        <>
          {/* Та же карточка standing, что и у обычного доната: живой предпросмотр прибавки очков. */}
          <StandingHeadline
            standing={standingQ.data}
            tiers={config?.tiers ?? []}
            gain={gain}
            loading={standingQ.isLoading}
          />

          <div className="border-t border-border" />

          <h3 className="text-h3 text-fg">Задание-донат</h3>

          <div className="flex flex-col gap-2">
            <Input
              label="Сумма, USDC"
              mono
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              className="bg-[var(--bg)]"
            />
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  size="sm"
                  className="w-full bg-[var(--bg)]"
                  onClick={() => setAmount(String(p))}
                >
                  ${p}
                </Button>
              ))}
            </div>
          </div>

          <Textarea
            label="Задание"
            placeholder="Что сделать стримеру…"
            maxLength={280}
            showCount
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-[var(--bg)]"
          />

          <div className="flex flex-col gap-1">
            <span className="text-small text-fg-muted">Срок на выполнение</span>
            <div className="flex items-start gap-2">
              <Input
                mono
                inputMode="numeric"
                placeholder="1"
                value={dlValue}
                onChange={(e) => setDlValue(e.target.value.replace(/[^\d]/g, ""))}
                error={deadlineError}
                className="flex-1 bg-[var(--bg)]"
              />
              <Select
                value={dlUnit}
                onChange={(e) => setDlUnit(e.target.value as "m" | "h" | "d")}
                aria-label="Единица срока"
                className="w-28 bg-[var(--bg)]"
              >
                <option value="m">минут</option>
                <option value="h">часов</option>
                <option value="d">дней</option>
              </Select>
            </div>
            <p className="text-caption text-fg-faint">
              Сколько у стримера времени после принятия (до 3 месяцев). Не успел — донат вернётся
              тебе.
            </p>
          </div>

          <Button
            variant="secondary"
            disabled={!valid || pending}
            onClick={create}
            className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
          >
            Создать задание
          </Button>

          <p className="text-small text-fg-faint">
            Деньги «в эскроу» — пока имитируются (реальный ончейн-эскроу позже).
          </p>
        </>
      )}
    </div>
  );
}

// ───────────────────────── левая часть: правила + активные ─────────────────────────

export function EscrowTaskHub({ channelId, ownerAddress, handle }: GameProps) {
  const viewer = useSession().data?.address ?? null;
  const tasksQ = useEscrowTasks(channelId);
  const { run, pending } = useRun(channelId);
  const tasks = tasksQ.data?.tasks ?? [];

  return (
    <div className="flex flex-col gap-6">
      <EscrowTaskRules />
      <section className="flex flex-col gap-3">
        <div className="text-caption uppercase tracking-wide text-fg-faint">
          Активные задания · {tasks.length}
        </div>
        {tasksQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : tasksQ.error ? (
          <ErrorState
            description="Не удалось загрузить задания."
            onRetry={() => tasksQ.refetch()}
          />
        ) : tasks.length === 0 ? (
          <EmptyState title="Пока нет заданий" description="Создай первое — форма справа." />
        ) : (
          <div className="flex flex-col gap-3">
            {[...tasks].reverse().map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                viewer={viewer}
                ownerAddress={ownerAddress}
                handle={handle}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EscrowTaskRules() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">Как работает</h3>
        <ol className="text-small flex list-inside list-decimal flex-col gap-1 text-fg-muted">
          <li>Зритель донатит с заданием — деньги замораживаются в эскроу.</li>
          <li>Стример выполняет задание и жмёт «Готово» (доказательство — сам стрим/VOD).</li>
          <li>12 ч окно: если никто не спорит — деньги уходят стримеру.</li>
          <li>
            Считаешь, что не выполнено? С репутацией ≥ порога поднимаешь спор → 24 ч голосование.
          </li>
          <li>Комьюнити решило «не выполнил» → 100% назад донору; «выполнил» → стримеру.</li>
        </ol>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">Почему это честно</h3>
        <ul className="text-small flex list-inside list-disc flex-col gap-1 text-fg-muted">
          <li>
            Приза нет: деньги либо стримеру за дело, либо назад донору — выиграть чужое нельзя (не
            пари).
          </li>
          <li>
            Голос взвешен репутацией на момент спора — накрутить «под спор» задним числом нельзя.
          </li>
          <li>Жюри не платят, а поднявший ложный спор рискует своей репутацией.</li>
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────── переиспользуемые части ─────────────────────────

function TaskCard({
  task,
  viewer,
  ownerAddress,
  handle,
  pending,
  run,
}: {
  task: EscrowTask;
  viewer: string | null;
  ownerAddress: string;
  handle: string;
  pending: boolean;
  run: Run;
}) {
  const now = Date.now();
  const due = task.status !== "RESOLVED" ? dueResolution(task, now) : null;
  const final = task.resolution ?? null;
  const effective = final ?? due;

  const isStreamer = !!viewer && viewer === ownerAddress;
  const isDonor = !!viewer && viewer === task.donor;
  const id = task.id;
  const within = (iso?: string) => !!iso && now <= Date.parse(iso);
  const alreadyVoted = !!viewer && (task.dispute?.votes.some((v) => v.voter === viewer) ?? false);
  const winner = effective?.outcome === "to_streamer" ? ownerAddress : task.donor;
  const canClaim = !!effective && !final?.claimed && viewer === winner;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <Amount micro={BigInt(task.amount)} variant="money" />
        <span className="text-caption rounded-pill border border-border px-2 py-0.5 text-fg-faint">
          {final
            ? `Итог: ${outcomeLabel(final.outcome)}${final.claimed ? " · забрано" : ""}`
            : STATUS_LABEL[task.status]}
        </span>
      </div>
      <p className="text-body break-words text-fg">{task.text}</p>

      {!final && due ? (
        <p className="text-small text-fg-faint">
          По времени готово к разрешению: {outcomeLabel(due.outcome)}.
        </p>
      ) : !final && deadlineLabel(task) ? (
        <p className="text-small text-fg-faint">{deadlineLabel(task)}</p>
      ) : null}
      {task.dispute ? (
        <>
          <DisputeTally dispute={task.dispute} />
          <Link
            href={`/c/${handle}/dispute/${encodeURIComponent(task.id)}`}
            className="text-small self-start text-info hover:underline"
          >
            Участники и голоса ({task.dispute.votes.length}) →
          </Link>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isStreamer && task.status === "PENDING" && !due ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("accept", { taskId: id }, "Принято")}
            >
              Принять
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("reject", { taskId: id }, "Отклонено")}
            >
              Отклонить
            </Button>
          </>
        ) : null}

        {isStreamer && task.status === "ACCEPTED" && !due ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("markDone", { taskId: id }, "Отмечено «Готово»")}
          >
            Готово
          </Button>
        ) : null}

        {isDonor && task.status === "ACCEPTED" && within(task.graceUntil) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run("cancel", { taskId: id }, "Отменено")}
          >
            Отменить
          </Button>
        ) : null}

        {task.status === "DONE" && !due && !!viewer && !isStreamer ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("raiseDispute", { taskId: id }, "Спор поднят")}
          >
            Оспорить
          </Button>
        ) : null}

        {task.status === "DISPUTED" &&
        !due &&
        !!viewer &&
        !isDonor &&
        !isStreamer &&
        !alreadyVoted ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "completed" }, "Голос учтён")}
            >
              Голос: выполнил
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "not_completed" }, "Голос учтён")}
            >
              Голос: не выполнил
            </Button>
          </>
        ) : null}

        {canClaim ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("claim", { taskId: id }, "Забрано")}
          >
            Забрать
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Полоса весов «выполнил» vs «не выполнил» + очки/голоса по сторонам + прогресс к кворуму + текущий лидер. */
function DisputeTally({ dispute }: { dispute: TaskDispute }) {
  let completed = 0;
  let not = 0;
  let cVotes = 0;
  let nVotes = 0;
  for (const v of dispute.votes) {
    if (v.choice === "completed") {
      completed += v.weight;
      cVotes += 1;
    } else {
      not += v.weight;
      nVotes += 1;
    }
  }
  const total = completed + not;
  const cPct = total > 0 ? (completed / total) * 100 : 50;
  const quorumMet = total >= dispute.quorum;
  const lead = total >= dispute.quorum && not > completed ? "to_donor" : "to_streamer";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col items-start">
          <span className="text-small" style={{ color: "var(--money)" }}>
            Выполнил
          </span>
          <span className="mono text-small text-fg">{completed} очков</span>
          <span className="text-caption text-fg-faint">{cVotes} голос(ов)</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-small" style={{ color: "var(--danger)" }}>
            Не выполнил
          </span>
          <span className="mono text-small text-fg">{not} очков</span>
          <span className="text-caption text-fg-faint">{nVotes} голос(ов)</span>
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div style={{ width: `${cPct}%`, backgroundColor: "var(--money)" }} />
        <div style={{ width: `${100 - cPct}%`, backgroundColor: "var(--danger)" }} />
      </div>
      <div className="text-caption flex flex-wrap items-center justify-between gap-x-3 text-fg-faint">
        <span className="mono">
          вес {total} / кворум {dispute.quorum}
          {quorumMet ? "" : " · кворум не собран"}
        </span>
        <span>
          сейчас ведёт:{" "}
          <span style={{ color: lead === "to_streamer" ? "var(--money)" : "var(--danger)" }}>
            {lead === "to_streamer" ? "стримеру" : "возврат донору"}
          </span>
        </span>
      </div>
    </div>
  );
}
