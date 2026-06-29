"use client";

import { useState } from "react";
import { Amount } from "@/components/domain/amount";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/lib/data/hooks";
import { toMicro } from "@/lib/utils";
import { useEscrowAction, useEscrowTasks } from "./hooks";
import { dueResolution } from "./machine";
import type { EscrowTask } from "./types";

/**
 * Экран мини-игры «задание-донат» на странице канала (G1.4). Ролевой: показывает действия по состоянию
 * задания и роли зрителя (донор / стример / присяжный / получатель). Данные — через типизированные хуки
 * (game-bus). Деньги пока мок (claim лишь помечает забранным); реальный эскроу — G3.
 */

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

export function EscrowTaskPanel({
  channelId,
  ownerAddress,
}: {
  channelId: string;
  ownerAddress: string;
}) {
  const viewer = useSession().data?.address ?? null;
  const tasksQ = useEscrowTasks(channelId);
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

  const tasks = tasksQ.data?.tasks ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-fg-muted">
        Донат с заданием: деньги «в эскроу», стример выполняет и жмёт «Готово», иначе — возврат.
        Спорные — на проверку комьюнити. Деньги пока имитируются (реальный эскроу — позже).
      </p>

      {viewer ? (
        <CreateForm
          pending={action.isPending}
          onCreate={(amount, text) => run("create", { amount, text }, "Задание создано")}
        />
      ) : (
        <p className="text-small rounded-lg border border-dashed border-border p-4 text-center text-fg-faint">
          Подключи кошелёк, чтобы создавать задания.
        </p>
      )}

      {tasksQ.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : tasksQ.error ? (
        <ErrorState description="Не удалось загрузить задания." onRetry={() => tasksQ.refetch()} />
      ) : tasks.length === 0 ? (
        <EmptyState title="Пока нет заданий" description="Создай первое задание-донат." />
      ) : (
        <div className="flex flex-col gap-3">
          {[...tasks].reverse().map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              viewer={viewer}
              ownerAddress={ownerAddress}
              pending={action.isPending}
              run={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({
  onCreate,
  pending,
}: {
  onCreate: (amount: string, text: string) => void;
  pending: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const num = Number(amount);
  const valid = amount !== "" && Number.isFinite(num) && num > 0 && text.trim().length > 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-[var(--bg)] p-4">
      <span className="font-display text-fg">Новое задание</span>
      <Input
        label="Сумма, USDC"
        mono
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(",", "."))}
      />
      <Textarea
        label="Задание"
        placeholder="Что сделать стримеру…"
        maxLength={280}
        showCount
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={!valid || pending}
        onClick={() => {
          onCreate(toMicro(num).toString(), text.trim());
          setAmount("");
          setText("");
        }}
      >
        Создать задание
      </Button>
    </div>
  );
}

function TaskCard({
  task,
  viewer,
  ownerAddress,
  pending,
  run,
}: {
  task: EscrowTask;
  viewer: string | null;
  ownerAddress: string;
  pending: boolean;
  run: Run;
}) {
  const now = Date.now();
  const due = task.status !== "RESOLVED" ? dueResolution(task, now) : null;
  const final = task.resolution ?? null;
  const effective = final ?? due; // итог или ожидаемый по времени исход

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
      ) : null}
      {task.status === "DISPUTED" && task.dispute ? (
        <p className="text-small text-fg-faint">
          Голосов: {task.dispute.votes.length} · вес считается по репутации на момент спора.
        </p>
      ) : null}

      {/* Действия по роли и состоянию */}
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
