"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { ChannelStatusBanner } from "@/components/domain/channel-status";
import { DonationCard } from "@/components/domain/donation-card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useDonations, useModerationQueue, useMyChannel, useSession } from "@/lib/data/hooks";

export default function StudioDashboardPage() {
  const sessionQ = useSession();
  const myChannelQ = useMyChannel();
  const channel = myChannelQ.data;
  const donationsQ = useDonations(channel?.id);
  const queueQ = useModerationQueue(channel?.id);

  if (sessionQ.isLoading || myChannelQ.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (myChannelQ.error) {
    return <ErrorState description="Не удалось загрузить канал." onRetry={() => myChannelQ.refetch()} />;
  }
  if (!sessionQ.data?.address) {
    return (
      <EmptyState
        title="Подключи кошелёк"
        description="Студия доступна после подключения кошелька."
        action={
          <Button asChild size="sm">
            <Link href="/connect">Подключить кошелёк</Link>
          </Button>
        }
      />
    );
  }
  if (!channel) {
    return (
      <EmptyState
        title="У тебя ещё нет канала"
        description="Создай канал, чтобы принимать донаты и копить комьюнити. Один канал на кошелёк."
        action={
          <Button asChild size="sm">
            <Link href="/studio/create">Создать канал</Link>
          </Button>
        }
      />
    );
  }

  const donations = donationsQ.data?.items ?? [];
  const turnover = donations.reduce((s, d) => s + d.amount, 0n);
  const heldCount = (queueQ.data ?? []).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-display-l text-fg">@{channel.handle}</h1>
        <span className="mono text-caption text-fg-faint">{channel.status}</span>
      </div>

      <ChannelStatusBanner status={channel.status} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Донатов" value={String(donations.length)} />
        <Metric label="Оборот" value={<Amount micro={turnover} />} />
        <Metric label="В очереди модерации" value={String(heldCount)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href="/studio/queue">Очередь модерации</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/studio/settings">Настройки канала</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/c/${channel.handle}/overlay`}>Оверлей для OBS</Link>
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Последние донаты</h2>
        {donationsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : donations.length === 0 ? (
          <EmptyState title="Пока нет донатов" description="Поделись ссылкой на канал, чтобы начать." />
        ) : (
          <div className="flex flex-col gap-2">
            {donations.slice(0, 6).map((d) => (
              <DonationCard key={d.id} donation={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-caption">{label}</span>
      <span className="text-h2 text-fg">{value}</span>
    </div>
  );
}
