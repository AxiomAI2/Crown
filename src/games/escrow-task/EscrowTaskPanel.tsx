"use client";

import Link from "next/link";
import { useState } from "react";
import { Amount } from "@/components/domain/amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/lib/data/hooks";
import { shortAddress, toMicro } from "@/lib/utils";
import { useEscrowAction, useEscrowTasks } from "./hooks";
import { dueResolution, tally } from "./machine";
import type { EscrowTask, TaskDispute } from "./types";

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
      {task.dispute ? (
        <>
          <DisputeTally dispute={task.dispute} />
          <DisputeDetailsDialog task={task} ownerAddress={ownerAddress} />
        </>
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

/**
 * Визуализация голосования по спору: полоса весов «выполнил» vs «не выполнил» (вес = очки репутации на
 * момент спора), сколько очков и голосов за каждую сторону, прогресс к кворуму и текущий лидер (tally).
 */
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
  const lead = tally(dispute); // текущий проектируемый исход

  const Side = ({
    label,
    points,
    votes,
    color,
    align,
  }: {
    label: string;
    points: number;
    votes: number;
    color: string;
    align: "left" | "right";
  }) => (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-small" style={{ color }}>
        {label}
      </span>
      <span className="mono text-small text-fg">
        {points} {points === 1 ? "очко" : "очков"}
      </span>
      <span className="text-caption text-fg-faint">{votes} голос(ов)</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <Side
          label="Выполнил"
          points={completed}
          votes={cVotes}
          color="var(--money)"
          align="left"
        />
        <Side label="Не выполнил" points={not} votes={nVotes} color="var(--danger)" align="right" />
      </div>
      {/* Полоса весов */}
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
          <span
            style={{ color: lead.outcome === "to_streamer" ? "var(--money)" : "var(--danger)" }}
          >
            {lead.outcome === "to_streamer" ? "стримеру" : "возврат донору"}
          </span>
        </span>
      </div>
    </div>
  );
}

/** Адрес-ссылка на профиль участника (/u/[address]); сам адрес — моноширинно (конвенция «адреса = данные»). */
function PartyLink({ address }: { address: string }) {
  return (
    <Link href={`/u/${address}`} className="mono text-small text-info hover:underline">
      {shortAddress(address)}
    </Link>
  );
}

function PartyRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-small text-fg-muted">{label}</span>
      <PartyLink address={address} />
    </div>
  );
}

/**
 * Диалог «Участники спора»: все стороны (стример/донор/оспаривающий) и поимённо голосующие с их выбором и
 * весом — каждый кликабелен в свой профиль. Прозрачность спора: видно, кто и с каким весом на что повлиял.
 */
function DisputeDetailsDialog({ task, ownerAddress }: { task: EscrowTask; ownerAddress: string }) {
  const d = task.dispute;
  if (!d) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-small self-start text-info hover:underline">
          Участники спора →
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Участники спора</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <PartyRow label="Стример (выполнял)" address={ownerAddress} />
            <PartyRow label="Донор (платил)" address={task.donor} />
            <PartyRow label="Оспаривает" address={d.by} />
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-caption uppercase tracking-wide text-fg-faint">
              Голоса · {d.votes.length}
            </div>
            {d.votes.length === 0 ? (
              <p className="text-small text-fg-faint">Пока никто не проголосовал.</p>
            ) : (
              <div className="scroll-thin flex max-h-60 flex-col overflow-y-auto [&>:last-child]:border-b-0">
                {d.votes.map((v) => (
                  <div
                    key={v.voter}
                    className="flex items-center justify-between gap-2 border-b border-border py-2"
                  >
                    <PartyLink address={v.voter} />
                    <div className="flex items-center gap-2">
                      <span
                        className="text-small"
                        style={{
                          color: v.choice === "completed" ? "var(--money)" : "var(--danger)",
                        }}
                      >
                        {v.choice === "completed" ? "выполнил" : "не выполнил"}
                      </span>
                      <span className="mono text-small text-fg">{v.weight} оч.</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
