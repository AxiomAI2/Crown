"use client";

import { ModerationItem } from "@/components/domain/moderation";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { useModerationQueue, useMyChannel, useSetMessageState } from "@/lib/data/hooks";

export default function ModerationQueuePage() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const queueQ = useModerationQueue(channelId);
  const setState = useSetMessageState(channelId ?? "");

  if (myChannelQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!channelId) return <EmptyState title="Сначала создай канал" />;

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

      {queueQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : queueQ.error ? (
        <ErrorState description="Не удалось загрузить очередь." onRetry={() => queueQ.refetch()} />
      ) : (queueQ.data ?? []).length === 0 ? (
        <EmptyState title="Очередь чиста" description="Новые сообщения на модерации появятся здесь." />
      ) : (
        <div className="flex flex-col gap-3">
          {queueQ.data!.map((m) => (
            <ModerationItem
              key={m.id}
              message={m}
              pending={setState.isPending && setState.variables?.messageId === m.id}
              onShow={() => act(m.id, "SHOWN")}
              onHide={() => act(m.id, "HIDDEN")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
