"use client";

import { useState } from "react";
import { Amount } from "@/components/domain/amount";
import { ModerationItem } from "@/components/domain/moderation";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Pager, usePager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useEscrowAction, useEscrowTasks } from "@/games/escrow-task/hooks";
import {
  useDonations,
  useManagedChannels,
  useModerationQueue,
  useSetMessageState,
} from "@/lib/data/hooks";
import { collapseWhitespace, shortAddress } from "@/lib/utils";

export default function ModerationQueuePage() {
  // Каналы, которыми управляешь: владелец ИЛИ модератор (раньше очередь брала только канал-владельца через
  // getMyChannel, поэтому модератор её не видел).
  const managedQ = useManagedChannels();
  const channels = managedQ.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channelId = selectedId ?? channels[0]?.id;

  const queueQ = useModerationQueue(channelId);
  const donationsQ = useDonations(channelId);
  const setState = useSetMessageState(channelId ?? "");
  // Задания-донаты с текстом на модерации (HELD) — та же очередь. «Отклонить» = reject (возврат донору).
  const tasksQ = useEscrowTasks(channelId);
  const taskAction = useEscrowAction(channelId ?? "");
  const heldTasks = (tasksQ.data?.tasks ?? []).filter((t) => t.textState === "HELD");

  // Джойн message → donation, чтобы показать донора и сумму в очереди.
  const byDonation = new Map((donationsQ.data?.items ?? []).map((d) => [d.id, d]));
  const pg = usePager(queueQ.data ?? [], 10); // постранично, чтобы очередь не уходила в бесконечность

  if (managedQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (channels.length === 0) {
    return (
      <EmptyState
        title="Нет каналов на модерации"
        description="Создай свой канал или попроси владельца добавить твой кошелёк в модераторы."
      />
    );
  }

  const heldCount = (queueQ.data ?? []).length + heldTasks.length;
  const currentChannel = channels.find((c) => c.id === channelId);

  function act(messageId: string, state: "SHOWN" | "HIDDEN") {
    setState.mutate(
      { messageId, state },
      {
        onSuccess: () => toast({ title: state === "SHOWN" ? "Показано" : "Скрыто" }),
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  // Задание: «Показать» → текст публикуется; «Отклонить» → reject (возврат донору) + текст скрыт, стример
  // деньги уже не заберёт (resolution=to_donor). Модерация текста для заданий влияет на деньги (в отличие от
  // донатов, где деньги финальны) — это осознанное правило продукта для эскроу-заданий.
  function taskAct(taskId: string, kind: "show" | "reject") {
    taskAction.mutate(
      kind === "show"
        ? { op: "setTextState", payload: { taskId, state: "SHOWN" } }
        : { op: "reject", payload: { taskId } },
      {
        onSuccess: () =>
          toast({ title: kind === "show" ? "Показано" : "Отклонено — возврат донору" }),
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-display-l text-fg">Очередь модерации</h1>
            {heldCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-money-bg px-2.5 py-0.5 text-small text-money">
                <span className="h-1.5 w-1.5 rounded-pill bg-money" />
                {heldCount} на модерации
              </span>
            ) : null}
          </div>
          <p className="text-fg-muted">
            Текст приватен до показа. Донаты: деньги/standing уже зачтены, решаешь судьбу текста. Задания:
            «Отклонить» вернёт эскроу донору — стример его уже не заберёт.
          </p>
        </div>
        {channels.length > 1 ? (
          <Select
            value={channelId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Канал"
            className="sm:w-56"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.handle}
              </option>
            ))}
          </Select>
        ) : currentChannel ? (
          <span className="mono shrink-0 text-small text-fg-faint">@{currentChannel.handle}</span>
        ) : null}
      </div>

      {queueQ.isLoading || tasksQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : queueQ.error ? (
        <ErrorState description="Не удалось загрузить очередь." onRetry={() => queueQ.refetch()} />
      ) : (queueQ.data ?? []).length === 0 && heldTasks.length === 0 ? (
        <EmptyState
          title="Очередь чиста"
          description="Новые сообщения и задания на модерации появятся здесь."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {(queueQ.data ?? []).length > 0 ? (
            <div className="flex flex-col">
              <div className="flex flex-col [&>:last-child]:border-b-0">
                {pg.pageItems.map((m) => {
                  const d = byDonation.get(m.donationId);
                  return (
                    <ModerationItem
                      key={m.id}
                      message={m}
                      donor={d?.donor}
                      donorName={d?.donorName}
                      amount={d?.amount}
                      pending={setState.isPending && setState.variables?.messageId === m.id}
                      onShow={() => act(m.id, "SHOWN")}
                      onHide={() => act(m.id, "HIDDEN")}
                    />
                  );
                })}
              </div>
              <div className="pt-4">
                <Pager
                  page={pg.page}
                  pageCount={pg.pageCount}
                  total={pg.total}
                  pageSize={pg.pageSize}
                  setPage={pg.setPage}
                  setPageSize={pg.setPageSize}
                />
              </div>
            </div>
          ) : null}

          {heldTasks.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-h3 text-fg">Задания на модерации · {heldTasks.length}</h2>
              <div className="flex flex-col [&>:last-child]:border-b-0">
                {heldTasks.map((t) => (
                  <div key={t.id} className="flex flex-col gap-2 border-b border-border py-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono truncate text-small text-fg">{shortAddress(t.donor)}</span>
                      <Amount micro={BigInt(t.amount)} />
                    </div>
                    <p className="break-words text-body text-fg">{collapseWhitespace(t.text)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={taskAction.isPending}
                        onClick={() => taskAct(t.id, "show")}
                      >
                        Показать
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={taskAction.isPending}
                        onClick={() => taskAct(t.id, "reject")}
                      >
                        Отклонить (возврат донору)
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
