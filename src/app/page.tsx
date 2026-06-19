"use client";

import { ChannelCardTile } from "@/components/domain/channel-card";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useDiscovery } from "@/lib/data/hooks";

export default function DiscoveryPage() {
  const { data, isLoading, error, refetch } = useDiscovery();

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Каналы</h1>
          <p className="text-fg-muted">Активированные каналы платформы — найди свой и набери standing.</p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <ErrorState description="Не удалось загрузить каналы." onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Пока нет каналов"
            description="Подключи кошелёк и активируй свой канал, чтобы он появился здесь."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {data.items.map((c) => (
              <ChannelCardTile key={c.channelId} card={c} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
