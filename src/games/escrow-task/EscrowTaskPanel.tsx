"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Amount, FeeSplit } from "@/components/domain/amount";
import { Monogram } from "@/components/domain/header-actions";
import { ModerationMenu } from "@/components/domain/moderation-menu";
import { ReportDialog } from "@/components/domain/report-dialog";
import { StandingHeadline } from "@/components/domain/standing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { explorerTxUrl } from "@/lib/chain/addresses";
import type { CanisterDisputeView } from "@/lib/chain/dispute-vote";
import { useChannelConfig, useDisputeParams, useSession, useStanding } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { collapseWhitespace, formatPoints, plural, shortAddress, timeAgo, toMicro } from "@/lib/utils";
import { useCanisterDispute, useEscrowAction, useEscrowTasks } from "./hooks";
import { dueResolution, isTextPublic, WINDOWS } from "./machine";
import type { EscrowTask, TaskDispute } from "./types";

// Те же пресеты сумм, что и в обычном донате (донат-виджет) — единый дизайн.
const PRESETS = [5, 10, 25, 100];

// Срок на выполнение донор вписывает вручную (число + единица); границы — из WINDOWS (executionMin..executionMax).
const H = 3_600_000;
const MIN = H / 60;
const DAY = 24 * H;
const UNIT_MS: Record<"m" | "h" | "d", number> = { m: MIN, h: H, d: DAY };

/** Живой таймстамп: тикает раз в секунду → таймеры на карточке идут в реальном времени (real-time). */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Обратный отсчёт до iso: «M:SS» посекундно (под короткие окна), ч/дн — для длинных. `now` — живой. */
function until(iso: string, now: number): string {
  const left = Date.parse(iso) - now;
  if (left <= 0) return "expired";
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m left`;
  return `${m}:${sec.toString().padStart(2, "0")} left`;
}

/** Какой дедлайн сейчас тикает (по стадии) — живая подпись для карточки. */
function deadlineLabel(task: EscrowTask, now: number): string | null {
  switch (task.status) {
    case "PENDING":
      return `Deliver by · ${until(task.executionDeadline, now)}`;
    case "ACCEPTED":
      return `Deliver · ${until(task.executionDeadline, now)}`;
    case "DONE":
      return task.disputeWindowEndsAt
        ? `Dispute by · ${until(task.disputeWindowEndsAt, now)}`
        : null;
    case "DISPUTED":
      return task.dispute ? `Voting · ${until(task.dispute.votingEndsAt, now)}` : null;
    default:
      return null;
  }
}

/**
 * UI мини-игры «задание-донат», две поверхности (ADR 0016 / редизайн раздела игр на канале):
 *  - EscrowTaskRail — ПРАВЫЙ рейл: действие (создать задание-донат);
 *  - EscrowTaskHub  — ЛЕВО: правила + «почему честно» + активные задания (мониторинг, споры).
 * Данные — через типизированные хуки (game-bus). Деньги в chain-режиме — реальный ончейн-эскроу (G3a).
 */

interface GameProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

const STATUS_LABEL: Record<EscrowTask["status"], string> = {
  PENDING: "Awaiting streamer",
  ACCEPTED: "In progress",
  DONE: "Dispute window",
  DISPUTED: "Dispute voting",
  RESOLVED: "Completed",
};
const outcomeLabel = (o: "to_streamer" | "to_donor") =>
  o === "to_streamer" ? "to streamer" : "refund to supporter";

type Run = (op: string, payload?: unknown, okMsg?: string, onDone?: () => void) => void;

function useRun(channelId: string): { run: Run; pending: boolean } {
  const action = useEscrowAction(channelId);
  const run: Run = (op, payload, okMsg, onDone) =>
    action.mutate(
      { op, payload },
      {
        onSuccess: () => {
          if (okMsg) toast({ variant: "success", title: okMsg });
          onDone?.(); // напр. закрыть диалог подтверждения и очистить форму — только по успеху
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Something went wrong",
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const num = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(num) && num > 0;
  const gain = amountValid ? pointsForAmount(toMicro(num)) : 0; // предпросмотр прибавки очков
  // Минимум канала для задания = бóльший из minDonation/minDonationWithText (задание — донат с текстом;
  // тот же расчёт на сервере в create → BELOW_MIN). Валидируем до подписи — не жечь газ об отказ.
  const minTaskMicro = config
    ? config.minDonationWithText > config.minDonation
      ? config.minDonationWithText
      : config.minDonation
    : null;
  const belowMin = amountValid && minTaskMicro !== null && toMicro(num) < minTaskMicro;
  const amountError = belowMin
    ? `Realm minimum for tasks is ${Number(minTaskMicro) / 1_000_000} USDC`
    : undefined;

  // §10-порог: право прислать задание. Гейтим форму заранее — иначе донор узнаёт об отказе только
  // после набора текста (сервер и chain-префлайт всё равно отсекут — тут честный ранний сигнал).
  const minRep = config?.minReputationToTask ?? 0;
  const lowRep = minRep > 0 && (standingQ.data?.points ?? 0) < minRep;

  const dlNum = Number(dlValue);
  const deadlineMs = dlNum * UNIT_MS[dlUnit];
  const deadlineValid =
    dlValue !== "" &&
    Number.isInteger(dlNum) &&
    deadlineMs >= WINDOWS.executionMin &&
    deadlineMs <= WINDOWS.executionMax;
  // Пол берём из WINDOWS.executionMin (ESC-17: > grace), чтобы подсказка не расходилась с валидацией:
  // fast-test = 2 мин, прод = 5 мин. Потолок executionMax = 90 дней ≈ 3 месяца.
  const deadlineError =
    dlValue !== "" && !deadlineValid
      ? `Deadline: from ${Math.round(WINDOWS.executionMin / MIN)} minutes to 3 months`
      : undefined;
  // Долгий срок = долгая заморозка: при игноре стримера возврат приходит только по ИСТЕЧЕНИИ срока сдачи
  // (эскроу, no-show/expired) — отдельного 72ч-окна принятия ончейн нет. Предупреждаем от 7 дней (коридор v1.1).
  const longDeadline = deadlineValid && deadlineMs > 7 * DAY;
  const valid = amountValid && !belowMin && text.trim().length > 0 && deadlineValid && !lowRep;

  function confirmCreate() {
    if (!valid) return;
    run(
      "create",
      { amount: toMicro(num).toString(), text: text.trim(), executionMs: deadlineMs },
      "Task created",
      () => {
        // очищаем и закрываем ТОЛЬКО по успеху — отменил подпись → форма и диалог на месте
        setConfirmOpen(false);
        setAmount("");
        setText("");
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
      {!viewer ? (
        <>
          <h3 className="text-h3 text-fg">Crown task</h3>
          <p className="text-small text-fg-muted">Connect your wallet to create a task.</p>
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

          <h3 className="text-h3 text-fg">Crown task</h3>

          <div className="flex flex-col gap-2">
            <Input
              label="Amount, USDC"
              mono
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              error={amountError}
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
            label="Task"
            placeholder="What the streamer should do…"
            maxLength={config?.messageMaxLen ?? 280}
            showCount
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-[var(--bg)]"
          />
          {lowRep ? (
            <p className="text-small text-fg-muted">
              Tasks on this realm start at {formatPoints(minRep)} Reign (you have{" "}
              {formatPoints(standingQ.data?.points ?? 0)}). Reign builds up from regular Crowns.
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <span className="text-small text-fg-muted">Time to deliver</span>
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
                aria-label="Deadline unit"
                className="w-28 bg-[var(--bg)]"
              >
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
              </Select>
            </div>
            {longDeadline ? (
              <p className="text-small text-warn">
                A long deadline means a long freeze: if the streamer simply ignores the task, the
                money sits in escrow for up to {Math.round(deadlineMs / DAY)} days and only comes
                back once the deadline passes. You can cancel only in the first ~
                {Math.round(WINDOWS.grace / MIN)} min after creating it.
              </p>
            ) : null}
          </div>

          <Button
            variant="secondary"
            disabled={!valid || pending}
            onClick={() => setConfirmOpen(true)}
            className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
          >
            Create task
          </Button>

          {/* Подтверждение с разбивкой — как у обычного доната (donate.tsx), но копирайт честный для
              эскроу: деньги НЕ финальны стримеру сразу, при no-show возвращаются донору без комиссии (§6). */}
          <Dialog
            open={confirmOpen}
            onOpenChange={(o) => {
              if (!pending) setConfirmOpen(o); // не даём закрыть во время подписи/финализации
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm</DialogTitle>
                <DialogDescription>
                  The money is frozen in escrow. To the streamer if they deliver; fully back to you
                  if they miss the deadline.
                </DialogDescription>
              </DialogHeader>
              {amountValid ? <FeeSplit amount={toMicro(num)} /> : null}
              <p className="text-small text-fg-muted">
                {pending
                  ? "Sign in your wallet and wait for on-chain finalization (~15–30s) — the task appears once the escrow is confirmed."
                  : "The breakdown applies if the streamer delivers. If they miss the deadline, we refund the full amount with no fee."}
              </p>
              {!pending && longDeadline ? (
                <p className="text-small text-warn">
                  Deadline of {Math.round(deadlineMs / DAY)} days: if the streamer ignores the task,
                  the refund only arrives after it passes — you can&apos;t pull the money out sooner.
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={pending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="money" loading={pending} onClick={confirmCreate}>
                  {pending ? "Finalizing…" : "Confirm and sign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
  // «Активные» = цикл ещё идёт. Завершённые (RESOLVED + забрано) уезжают в ленту; отклонённые стримером
  // (hidden) прячем отсюда тоже — эскроу вернётся донору сам по таймеру.
  const active = (tasksQ.data?.tasks ?? []).filter(
    (t) => !t.hidden && !(t.status === "RESOLVED" && t.resolution?.claimed),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="text-caption uppercase tracking-wide text-fg-faint">
          Active tasks · {active.length}
        </div>
        {tasksQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : tasksQ.error ? (
          <ErrorState
            description="Failed to load tasks."
            onRetry={() => tasksQ.refetch()}
          />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active tasks"
            description="Create a task on the right. Completed ones are in the Crowns feed."
          />
        ) : (
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {[...active].reverse().map((t) => (
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

/** Человекочитаемое окно из WINDOWS — правила не хардкодят длительности (fast-режим и калибровка). */
const fmtWindow = (ms: number) =>
  ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 60_000)} min`;

/**
 * Правила игры — показываются в модалке «i» пикера игр (GameActionRail). Внешний контейнер даёт модалка.
 * В icp-режиме окна/пороги спора — ДЕЙСТВУЮЩИЕ параметры канала из канистры (M1/M2: их задаёт владелец,
 * донор видит их ДО открытия спора); вне icp (или пока канистра не ответила) — дефолты машины.
 */
export function EscrowTaskRules({ channelId }: { channelId?: string }) {
  const params = useDisputeParams(channelId).data?.effective;
  const disputeWindow = params ? params.disputeWindowSecs * 1000 : WINDOWS.disputeWindow;
  const votingWindow = params ? params.votingWindowSecs * 1000 : WINDOWS.voting;
  const minRepPts = params ? Number(params.minReputationToDisputeMicro) / 1_000_000 : null;
  const quorumPts = params ? Number(params.quorumMicro) / 1_000_000 : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">How it works</h3>
        <ol className="text-small flex list-inside list-decimal flex-col gap-1 text-fg-muted">
          <li>A viewer crowns with a task — the money is frozen in escrow.</li>
          <li>
            The streamer delivers the task and hits &quot;Done&quot; (the proof is the stream/VOD
            itself).
          </li>
          <li>
            {fmtWindow(disputeWindow)} dispute window: if no one disputes, the money goes to the
            streamer.
          </li>
          <li>
            Think it wasn&apos;t delivered? With Reign{" "}
            {minRepPts != null ? (
              <span className="mono">≥ {formatPoints(minRepPts)}</span>
            ) : (
              "≥ the threshold"
            )}{" "}
            you raise a dispute → {fmtWindow(votingWindow)} voting
            {quorumPts != null ? (
              <>
                {" "}
                (turnout quorum — <span className="mono">{formatPoints(quorumPts)}</span> Reign; if
                it&apos;s not met, the money goes to the streamer)
              </>
            ) : null}
            .
          </li>
          <li>
            Community decides &quot;not delivered&quot; → 100% back to the supporter;
            &quot;delivered&quot; → to the streamer.
          </li>
        </ol>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">Why it&apos;s fair</h3>
        <ul className="text-small flex list-inside list-disc flex-col gap-1 text-fg-muted">
          <li>
            There&apos;s no prize: the money either goes to the streamer for the work or back to the
            supporter — you can&apos;t win someone else&apos;s money (not a bet).
          </li>
          <li>
            A vote is weighted by Reign at the time of the dispute — you can&apos;t farm it after the
            fact just for the vote.
          </li>
          <li>The jury isn&apos;t paid, and whoever raises a false dispute risks their own Reign.</li>
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────── переиспользуемые части ─────────────────────────

/**
 * Модерация задания — ЕДИНАЯ для ленты и «Активных» (одинаковое «…» и флажок, как у доната). Обычному зрителю
 * — флажок «Пожаловаться»; владельцу/модератору — «…» (та же ModerationMenu). Жалоба на задание идёт через
 * игровой экшен `report` (задание — не сообщение доната). Автору задания и без входа — ничего.
 */
function TaskModeration({
  task,
  viewer,
  isManager,
}: {
  task: EscrowTask;
  viewer?: string | null;
  isManager: boolean;
}) {
  const action = useEscrowAction(task.channelId);
  const reportSubmit = async (reason: string) =>
    (await action.mutateAsync({ op: "report", payload: { taskId: task.id, reason } })) as {
      reports?: number;
      hidden?: boolean;
    };
  const title = "Report this task";
  const description =
    "Pick a reason — the report goes to the streamer and the operator. With several reports the task text is auto-hidden.";
  if (isManager)
    return (
      <ModerationMenu
        channelId={task.channelId}
        donor={task.donor}
        reportSubmit={reportSubmit}
        reportTitle={title}
        reportDescription={description}
      />
    );
  if (viewer && viewer !== task.donor)
    return (
      <ReportDialog
        channelId={task.channelId}
        onSubmit={reportSubmit}
        title={title}
        description={description}
      />
    );
  return null;
}

/**
 * Read-only строка задания для ОБЩЕЙ ленты донатов канала (ChannelFeed): историческая запись — донор,
 * метка «Задание» + статус/исход, сумма, текст, время, ссылка на эскроу. Без действий/таймера (управление —
 * во вкладке «Игры»). Тот же ряд-скелет, что DonationCard variant="row" → единый вид с обычными донатами.
 */
export function TaskFeedRow({
  task,
  handle,
  viewer,
  manageChannelId,
}: {
  task: EscrowTask;
  handle: string;
  viewer?: string | null; // текущий зритель — чтобы показать «Пожаловаться» (не своё задание, не менеджеру)
  manageChannelId?: string; // задан (владелец/модератор) → «…» с бан/скрытием донора, как у доната
}) {
  const final = task.resolution ?? null;
  const status = final
    ? `Result: ${outcomeLabel(final.outcome)}${final.claimed ? " · claimed" : ""}`
    : STATUS_LABEL[task.status];
  const name = shortAddress(task.donor);
  // Тот же лёгкий ряд-с-аватаром, что у обычного доната (DonationCard variant="row" avatar). Задание-специфика
  // компактна: бейджи «Задание»+статус и, если был спор, ОДНА строка-ссылка на табло — само табло голосов в
  // ленту не тянем (перегружает); полный расклад — на странице спора.
  return (
    <div className="flex gap-3 border-b border-border py-3.5">
      <Monogram name={name} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/u/${task.donor}`}
              className="truncate text-small font-medium text-fg transition-colors hover:text-status"
            >
              {name}
            </Link>
            <span className="text-caption shrink-0 rounded-pill border border-money px-2 py-0.5 text-money">
              Task
            </span>
            <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
              {status}
            </span>
          </div>
          <Amount micro={BigInt(task.amount)} className="shrink-0" />
        </div>
        {/* Текст — только если опубликован (SHOWN, §4.6). Иначе плашка (приватный текст не светим). */}
        {isTextPublic(task) ? (
          <p className="text-body break-words text-fg">{collapseWhitespace(task.text)}</p>
        ) : task.operatorBlocked ? (
          <p className="text-small italic text-fg-faint">[removed by the platform operator]</p>
        ) : (
          <p className="text-small italic text-fg-faint">[hidden]</p>
        )}
        {/* Был спор → одна компактная строка-ссылка на табло (голоса/вердикт там, ленту не грузим). */}
        {task.dispute ? (
          <Link
            href={`/c/${handle}/dispute/${encodeURIComponent(task.id)}`}
            className="text-caption self-start text-fg-muted transition-colors hover:text-info"
          >
            Dispute · {task.dispute.votes.length}{" "}
            {plural(task.dispute.votes.length, ["vote", "votes", "votes"])} →
          </Link>
        ) : null}
        <div className="text-caption flex flex-wrap items-center gap-2 text-fg-faint">
          <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
          <div className="ml-auto flex items-center gap-1">
            {task.fundTx ? (
              <a
                href={explorerTxUrl(task.fundTx)}
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                title="Escrow in the blockchain explorer"
                aria-label="Escrow in the blockchain explorer"
              >
                <ExternalLinkIcon className="h-4 w-4" />
              </a>
            ) : null}
            <TaskModeration task={task} viewer={viewer} isManager={!!manageChannelId} />
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const now = useNow(); // живой — таймеры и появление кнопок (claim/резолв) в реальном времени
  const due = task.status !== "RESOLVED" ? dueResolution(task, now) : null;
  const final = task.resolution ?? null;
  const effective = final ?? due;

  const isStreamer = !!viewer && viewer === ownerAddress;
  const isDonor = !!viewer && viewer === task.donor;
  const id = task.id;
  // M2 (ADR 0021): спор chain-задачи живёт в КАНИСТРЕ (открытие/голоса — подписи кошельков,
  // вердикт исполняет тресхолд-резолвер). Ручной оператор-резолвер удалён — человека в цепочке
  // решения больше нет. Задачи без эскроу (mock/api) спорятся по-старому, оффчейн.
  const canisterDisputeQ = useCanisterDispute(task.channelId, id, task.escrowTaskId);
  const cd = canisterDisputeQ.data ?? null;
  const cdVoted = !!viewer && !!cd && cd.votes.some((v) => v.voter === viewer);
  const cdVotingOpen = !!cd && !cd.verdict && !!cd.votingEndsAtMs && now <= cd.votingEndsAtMs;
  const within = (iso?: string) => !!iso && now <= Date.parse(iso);
  const alreadyVoted = !!viewer && (task.dispute?.votes.some((v) => v.voter === viewer) ?? false);
  const winner = effective?.outcome === "to_streamer" ? ownerAddress : task.donor;
  // При споре канистры (cd) «Забрать» открывается только после НАСТОЯЩЕГО исхода (task.resolution:
  // тресхолд-резолвер исполнил вердикт ончейн и индексер это увидел) — «дозревший» по времени `due`
  // здесь не основание: эскроу ончейн в Disputed, программа отклонит claim.
  const canClaim = !!effective && !final?.claimed && viewer === winner && (!cd || !!final);
  // Стример/автор видят текст всегда; остальным — только SHOWN (иначе плашка «на модерации»/«скрыто»).
  // Операторский тейкдаун перебивает роль: снятый оператором текст не виден НИКОМУ (даже стримеру/автору).
  const canSeeText = !task.operatorBlocked && (isTextPublic(task) || isStreamer || isDonor);

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      {/* Тот же ряд-стандарт, что лента донатов (DonationCard variant="row"): донор+бейдж статуса → сумма;
          текст; мета-строка (время · дедлайн/исход · ссылка на эскроу). Сумма нейтральная (не money-green —
          деньги в игре ещё не финальны: при no-show возвращаются донору). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${task.donor}`}
            className="text-small truncate text-fg transition-colors hover:text-status"
          >
            {shortAddress(task.donor)}
          </Link>
          <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
            {final
              ? `Result: ${outcomeLabel(final.outcome)}${final.claimed ? " · claimed" : ""}`
              : STATUS_LABEL[task.status]}
          </span>
        </div>
        <Amount micro={BigInt(task.amount)} />
      </div>

      {canSeeText ? (
        <p className="text-body break-words text-fg">{collapseWhitespace(task.text)}</p>
      ) : task.operatorBlocked ? (
        <p className="text-body italic text-fg-faint">[removed by the platform operator]</p>
      ) : (
        <p className="text-body italic text-fg-faint">[hidden]</p>
      )}

      {cd ? <CanisterDisputeBlock cd={cd} now={now} /> : null}

      {/* Табло старого оффчейн-спора — только когда нет канистрового (иначе оно уже в блоке выше). */}
      {task.dispute && !cd ? <DisputeTally dispute={task.dispute} /> : null}
      {/* Ссылка на полную страницу спора — для ОБОИХ контуров: в icp-режиме провайдер вливает
          спор канистры в task.dispute, и страница «Участники и голоса» читает его тем же видом. */}
      {task.dispute ? (
        <Link
          href={`/c/${handle}/dispute/${encodeURIComponent(task.id)}`}
          className="text-small self-start text-info hover:underline"
        >
          Participants and votes ({task.dispute.votes.length}) →
        </Link>
      ) : null}

      <div className="text-small flex flex-wrap items-center gap-2 text-fg-faint">
        <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
        {!final && due ? (
          <span>· ready to resolve: {outcomeLabel(due.outcome)}</span>
        ) : !final && deadlineLabel(task, now) ? (
          <span className="mono">· {deadlineLabel(task, now)}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {/* Эскроу-ссылка (переживает claim) + модерация (флажок/«…») — единый вид с лентой. */}
          {task.fundTx ? (
            <a
              href={explorerTxUrl(task.fundTx)}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="Escrow in the blockchain explorer"
              aria-label="Escrow in the blockchain explorer"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          <TaskModeration task={task} viewer={viewer} isManager={isStreamer} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Очередь модерации текста: «Показать» — только пока задание живо (таймер не истёк, не разрешено),
            иначе публиковать поздно (уходит в возврат донору). «Скрыть» — только ДО принятия (PENDING): после
            accept деньги могут уйти стримеру, поэтому текст обязан оставаться на виду у комьюнити (ESC-19). */}
        {isStreamer && isTextPublic(task) && task.status === "PENDING" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run("setTextState", { taskId: id, state: "HIDDEN" }, "Text hidden")}
          >
            Hide text
          </Button>
        ) : isStreamer && !isTextPublic(task) && !task.operatorBlocked && !due && !final ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("setTextState", { taskId: id, state: "SHOWN" }, "Text shown")}
          >
            Show text
          </Button>
        ) : null}
        {isStreamer && task.status === "PENDING" && !due ? (
          <>
            {/* «Принять» = ончейн-accept: он же раскрывает текст комьюнити (ESC-19) — гейта «покажи сначала»
                больше нет, публикация происходит самим принятием. */}
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("accept", { taskId: id }, "Accepted — text shown")}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              // Отказ = скрыть из фронтенда (без ончейн-tx/газа). Эскроу вернётся донору сам по таймеру.
              onClick={() => run("hide", { taskId: id }, "Rejected — refunds to the supporter on the timer")}
            >
              Reject
            </Button>
          </>
        ) : null}

        {isStreamer && task.status === "ACCEPTED" && !due ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("markDone", { taskId: id }, "Marked as Done")}
          >
            Done
          </Button>
        ) : null}

        {isDonor && task.status === "ACCEPTED" && within(task.graceUntil) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run("cancel", { taskId: id }, "Canceled")}
          >
            Cancel
          </Button>
        ) : null}

        {/* «Оспорить»: для chain-задач в icp-режиме провайдер сам уводит операцию в канистру
            (подпись кошельком); для остальных — прежний оффчейн-путь. Скрываем, если спор
            в канистре уже открыт (cd). */}
        {task.status === "DONE" && !due && !!viewer && !isStreamer && !cd ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("raiseDispute", { taskId: id }, "Dispute raised")}
          >
            Dispute
          </Button>
        ) : null}

        {task.status === "DISPUTED" &&
        !cd &&
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
              onClick={() => run("vote", { taskId: id, choice: "completed" }, "Vote counted")}
            >
              Vote: delivered
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "not_completed" }, "Vote counted")}
            >
              Vote: not delivered
            </Button>
          </>
        ) : null}

        {/* Голос в споре КАНИСТРЫ: та же операция vote — провайдер подпишет и отправит в арбитр. */}
        {cdVotingOpen && !!viewer && !isDonor && !isStreamer && !cdVoted ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "completed" }, "Vote counted")}
            >
              Vote: delivered
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "not_completed" }, "Vote counted")}
            >
              Vote: not delivered
            </Button>
          </>
        ) : null}

        {canClaim ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("claim", { taskId: id }, "Claimed")}
          >
            Claim
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Спор в КАНИСТРЕ (M2): открытое табло (решение владельца — голоса видны живьём), окно,
 * вердикт и ончейн-подписи тресхолд-резолвера. Табло переиспользует DisputeTally —
 * синтезируем оффчейн-форму спора из данных канистры (micro → очки на границе UI).
 */
function CanisterDisputeBlock({ cd, now }: { cd: CanisterDisputeView; now: number }) {
  const synthetic: TaskDispute = {
    by: cd.openedBy ?? "",
    openedAt: new Date(cd.openedAtMs ?? 0).toISOString(),
    votingEndsAt: new Date(cd.votingEndsAtMs ?? 0).toISOString(),
    quorum: Number(cd.quorumMicro) / 1_000_000,
    votes: cd.votes.map((v) => ({
      voter: v.voter,
      choice: v.choice,
      weight: Number(v.weightMicro) / 1_000_000,
      at: new Date(v.atMs).toISOString(),
    })),
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-caption flex flex-wrap items-center gap-x-3 text-fg-faint">
        <span>
          The dispute is resolved by the canister — a threshold resolver signs the outcome; the
          platform does not take part.
        </span>
        {!cd.verdict && cd.votingEndsAtMs ? (
          <span className="mono">
            voting ·{" "}
            {now <= cd.votingEndsAtMs
              ? until(new Date(cd.votingEndsAtMs).toISOString(), now)
              : "awaiting verdict"}
          </span>
        ) : null}
      </div>
      <DisputeTally dispute={synthetic} />
      {cd.verdict ? (
        <div className="text-small flex flex-wrap items-center gap-x-3 text-fg-muted">
          <span>
            Verdict:{" "}
            <span
              style={{
                color: cd.verdict.outcome === "to_streamer" ? "var(--money)" : "var(--danger)",
              }}
            >
              {outcomeLabel(cd.verdict.outcome)}
            </span>
          </span>
          {cd.resolveTx ? (
            <a
              href={explorerTxUrl(cd.resolveTx)}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              resolver signature ↗
            </a>
          ) : (
            <span className="text-fg-faint">executing on-chain…</span>
          )}
        </div>
      ) : null}
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
            Delivered
          </span>
          <span className="mono text-small text-fg">{completed} pts</span>
          <span className="text-caption text-fg-faint">{cVotes} vote(s)</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-small" style={{ color: "var(--danger)" }}>
            Not delivered
          </span>
          <span className="mono text-small text-fg">{not} pts</span>
          <span className="text-caption text-fg-faint">{nVotes} vote(s)</span>
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div style={{ width: `${cPct}%`, backgroundColor: "var(--money)" }} />
        <div style={{ width: `${100 - cPct}%`, backgroundColor: "var(--danger)" }} />
      </div>
      <div className="text-caption flex flex-wrap items-center justify-between gap-x-3 text-fg-faint">
        <span className="mono">
          weight {total} / quorum {dispute.quorum}
          {quorumMet ? "" : " · quorum not reached"}
        </span>
        <span>
          leading now:{" "}
          <span style={{ color: lead === "to_streamer" ? "var(--money)" : "var(--danger)" }}>
            {lead === "to_streamer" ? "to streamer" : "refund to supporter"}
          </span>
        </span>
      </div>
    </div>
  );
}
