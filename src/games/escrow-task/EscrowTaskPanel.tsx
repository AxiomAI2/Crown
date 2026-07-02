"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Amount, FeeSplit } from "@/components/domain/amount";
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
import { ESCROW_RESOLVER, explorerTxUrl } from "@/lib/chain/addresses";
import { useChannelConfig, useSession, useStanding } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { collapseWhitespace, formatPoints, shortAddress, timeAgo, toMicro } from "@/lib/utils";
import { useEscrowAction, useEscrowTasks } from "./hooks";
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
  if (left <= 0) return "срок истёк";
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `осталось ${d}д ${h}ч`;
  if (h > 0) return `осталось ${h}ч ${m.toString().padStart(2, "0")}м`;
  return `осталось ${m}:${sec.toString().padStart(2, "0")}`;
}

/** Какой дедлайн сейчас тикает (по стадии) — живая подпись для карточки. */
function deadlineLabel(task: EscrowTask, now: number): string | null {
  switch (task.status) {
    case "PENDING":
      return `Сдать до · ${until(task.executionDeadline, now)}`;
    case "ACCEPTED":
      return `Выполнить · ${until(task.executionDeadline, now)}`;
    case "DONE":
      return task.disputeWindowEndsAt ? `Оспорить до · ${until(task.disputeWindowEndsAt, now)}` : null;
    case "DISPUTED":
      return task.dispute ? `Голосование · ${until(task.dispute.votingEndsAt, now)}` : null;
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
  PENDING: "Ждёт стримера",
  ACCEPTED: "В работе",
  DONE: "Окно оспаривания",
  DISPUTED: "Голосование по спору",
  RESOLVED: "Завершено",
};
const outcomeLabel = (o: "to_streamer" | "to_donor") =>
  o === "to_streamer" ? "стримеру" : "возврат донору";

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
    ? `Минимум канала для заданий — ${Number(minTaskMicro) / 1_000_000} USDC`
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
      ? `Срок: от ${Math.round(WINDOWS.executionMin / MIN)} минут до 3 месяцев`
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
      "Задание создано",
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
            label="Задание"
            placeholder="Что сделать стримеру…"
            maxLength={config?.messageMaxLen ?? 280}
            showCount
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-[var(--bg)]"
          />
          {lowRep ? (
            <p className="text-small text-fg-muted">
              Задания на этом канале — с {formatPoints(minRep)} очков репутации (у тебя{" "}
              {formatPoints(standingQ.data?.points ?? 0)}). Репутация набирается обычными донатами.
            </p>
          ) : null}

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
            {longDeadline ? (
              <p className="text-small text-warn">
                Долгий срок — долгая заморозка: если стример просто проигнорирует задание, деньги
                пролежат в эскроу до {Math.round(deadlineMs / DAY)} дней и вернутся только по
                истечении срока. Отменить можно лишь в первые ~
                {Math.round(WINDOWS.grace / MIN)} мин после создания.
              </p>
            ) : null}
          </div>

          <Button
            variant="secondary"
            disabled={!valid || pending}
            onClick={() => setConfirmOpen(true)}
            className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
          >
            Создать задание
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
                <DialogTitle>Подтверждение</DialogTitle>
                <DialogDescription>
                  Деньги замораживаются в эскроу. Стримеру — если выполнит; тебе полностью — если не
                  успеет в срок.
                </DialogDescription>
              </DialogHeader>
              {amountValid ? <FeeSplit amount={toMicro(num)} /> : null}
              <p className="text-small text-fg-muted">
                {pending
                  ? "Подпиши в кошельке и подожди финализации в сети (~15–30с) — задание появится, когда эскроу подтвердится."
                  : "Разбивка — если стример выполнит. Не успеет в срок — вернём всю сумму без комиссии."}
              </p>
              {!pending && longDeadline ? (
                <p className="text-small text-warn">
                  Срок {Math.round(deadlineMs / DAY)} дней: если стример проигнорирует задание,
                  возврат придёт только после его истечения — забрать деньги раньше нельзя.
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={pending}>
                    Отмена
                  </Button>
                </DialogClose>
                <Button variant="money" loading={pending} onClick={confirmCreate}>
                  {pending ? "Финализируем…" : "Подтвердить и подписать"}
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
          Активные задания · {active.length}
        </div>
        {tasksQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : tasksQ.error ? (
          <ErrorState
            description="Не удалось загрузить задания."
            onRetry={() => tasksQ.refetch()}
          />
        ) : active.length === 0 ? (
          <EmptyState
            title="Нет активных заданий"
            description="Создай задание справа. Завершённые — в ленте «Донаты»."
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
  ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} ч` : `${Math.round(ms / 60_000)} мин`;

/** Правила игры — показываются в модалке «i» пикера игр (GameActionRail). Внешний контейнер даёт модалка. */
export function EscrowTaskRules() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">Как работает</h3>
        <ol className="text-small flex list-inside list-decimal flex-col gap-1 text-fg-muted">
          <li>Зритель донатит с заданием — деньги замораживаются в эскроу.</li>
          <li>Стример выполняет задание и жмёт «Готово» (доказательство — сам стрим/VOD).</li>
          <li>
            Окно оспаривания {fmtWindow(WINDOWS.disputeWindow)}: если никто не спорит — деньги
            уходят стримеру.
          </li>
          <li>
            Считаешь, что не выполнено? С репутацией ≥ порога поднимаешь спор → голосование{" "}
            {fmtWindow(WINDOWS.voting)}.
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
  const title = "Пожаловаться на задание";
  const description =
    "Выбери причину — жалоба уйдёт стримеру и оператору. При нескольких жалобах текст задания авто-скрывается.";
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
    ? `Итог: ${outcomeLabel(final.outcome)}${final.claimed ? " · забрано" : ""}`
    : STATUS_LABEL[task.status];
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${task.donor}`}
            className="truncate text-small text-fg transition-colors hover:text-status"
          >
            {shortAddress(task.donor)}
          </Link>
          <span className="text-caption shrink-0 rounded-pill border border-money px-2 py-0.5 text-money">
            Задание
          </span>
          <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
            {status}
          </span>
        </div>
        <Amount micro={BigInt(task.amount)} />
      </div>
      {/* Текст — только если опубликован (SHOWN). Иначе «[не показано]» (не светим приватный текст, §4.6);
          снятое оператором — «[снято оператором платформы]» (тейкдаун модерации перебивает публикацию). */}
      {isTextPublic(task) ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(task.text)}</p>
      ) : task.operatorBlocked ? (
        <p className="text-body italic text-fg-faint">[снято оператором платформы]</p>
      ) : (
        <p className="text-body italic text-fg-faint">[не показано]</p>
      )}
      {/* Был спор → показываем таллю голосов и ссылку на полную страницу деталей спора (та же, что в «Играх»). */}
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
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-faint">
        <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
        <div className="ml-auto flex items-center gap-2">
          {task.fundTx ? (
            <a
              href={explorerTxUrl(task.fundTx)}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="Эскроу в блокчейн-эксплорере"
              aria-label="Эскроу в блокчейн-эксплорере"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          <TaskModeration task={task} viewer={viewer} isManager={!!manageChannelId} />
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
  // Резолвер спора (оператор) — может пометить эскроу спорным и зафиксировать вердикт на цепочке (G3a).
  const isResolver = !!viewer && !!ESCROW_RESOLVER && viewer === ESCROW_RESOLVER && !!task.escrowTaskId;
  const id = task.id;
  const within = (iso?: string) => !!iso && now <= Date.parse(iso);
  const alreadyVoted = !!viewer && (task.dispute?.votes.some((v) => v.voter === viewer) ?? false);
  const winner = effective?.outcome === "to_streamer" ? ownerAddress : task.donor;
  const canClaim = !!effective && !final?.claimed && viewer === winner;
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
            className="truncate text-small text-fg transition-colors hover:text-status"
          >
            {shortAddress(task.donor)}
          </Link>
          <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
            {final
              ? `Итог: ${outcomeLabel(final.outcome)}${final.claimed ? " · забрано" : ""}`
              : STATUS_LABEL[task.status]}
          </span>
        </div>
        <Amount micro={BigInt(task.amount)} />
      </div>

      {canSeeText ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(task.text)}</p>
      ) : task.operatorBlocked ? (
        <p className="text-body italic text-fg-faint">[снято оператором платформы]</p>
      ) : (
        <p className="text-body italic text-fg-faint">[не показано]</p>
      )}

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

      <div className="flex flex-wrap items-center gap-2 text-small text-fg-faint">
        <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
        {!final && due ? (
          <span>· готово к разрешению: {outcomeLabel(due.outcome)}</span>
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
              title="Эскроу в блокчейн-эксплорере"
              aria-label="Эскроу в блокчейн-эксплорере"
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
            onClick={() => run("setTextState", { taskId: id, state: "HIDDEN" }, "Текст скрыт")}
          >
            Скрыть текст
          </Button>
        ) : isStreamer && !isTextPublic(task) && !task.operatorBlocked && !due && !final ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("setTextState", { taskId: id, state: "SHOWN" }, "Текст показан")}
          >
            Показать текст
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
              onClick={() => run("accept", { taskId: id }, "Принято — текст показан")}
            >
              Принять
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              // Отказ = скрыть из фронтенда (без ончейн-tx/газа). Эскроу вернётся донору сам по таймеру.
              onClick={() => run("hide", { taskId: id }, "Отклонено — вернётся донору по таймеру")}
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

        {/* Резолвер (оператор) — во время спора метит эскроу спорным (защита от таймаута). */}
        {isResolver && task.status === "DISPUTED" && !due && !final ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("markDisputed", { taskId: id }, "Помечено спорным на цепочке")}
          >
            Пометить спорным (on-chain)
          </Button>
        ) : null}

        {/* Резолвер — после голосования фиксирует вердикт на цепочке (исход берём из тальи). */}
        {isResolver && task.dispute && due && !final ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(
                "resolveDispute",
                { taskId: id, toStreamer: due.outcome === "to_streamer" },
                "Итог зафиксирован на цепочке",
              )
            }
          >
            Зафиксировать на цепочке: {outcomeLabel(due.outcome)}
          </Button>
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
