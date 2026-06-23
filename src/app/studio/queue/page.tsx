"use client";

import { useState } from "react";
import { ModerationItem } from "@/components/domain/moderation";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Pager, usePager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  useDonations,
  useManagedChannels,
  useModerationQueue,
  useSetMessageState,
} from "@/lib/data/hooks";

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

  function act(messageId: string, state: "SHOWN" | "HIDDEN") {
    setState.mutate(
      { messageId, state },
      {
        onSuccess: () => toast({ title: state === "SHOWN" ? "Показано" : "Скрыто" }),
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Очередь модерации</h1>
        <p className="text-fg-muted">
          Текст приватен до показа. Реши судьбу текста — деньги и standing донора уже зачтены.
        </p>
      </div>

      {channels.length > 1 ? (
        <Select
          label="Канал"
          value={channelId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="sm:w-64"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              @{c.handle}
            </option>
          ))}
        </Select>
      ) : null}

      {queueQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : queueQ.error ? (
        <ErrorState description="Не удалось загрузить очередь." onRetry={() => queueQ.refetch()} />
      ) : (queueQ.data ?? []).length === 0 ? (
        <EmptyState title="Очередь чиста" description="Новые сообщения на модерации появятся здесь." />
      ) : (
        <div className="flex flex-col gap-3">
          {pg.pageItems.map((m) => {
            const d = byDonation.get(m.donationId);
            return (
              <ModerationItem
                key={m.id}
                message={m}
                donor={d?.donor}
                amount={d?.amount}
                pending={setState.isPending && setState.variables?.messageId === m.id}
                onShow={() => act(m.id, "SHOWN")}
                onHide={() => act(m.id, "HIDDEN")}
              />
            );
          })}
          <Pager
            page={pg.page}
            pageCount={pg.pageCount}
            total={pg.total}
            pageSize={pg.pageSize}
            setPage={pg.setPage}
            setPageSize={pg.setPageSize}
          />
        </div>
      )}
    </div>
  );
}
