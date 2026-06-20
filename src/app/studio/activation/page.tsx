"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { ACTIVATION_FEE_MICRO } from "@/lib/chain/addresses";
import { useActivateChannel, useMyChannel } from "@/lib/data/hooks";
import { timeAgo } from "@/lib/utils";

const ACTIVATION_FEE = ACTIVATION_FEE_MICRO;

export default function ActivationPage() {
  const myChannelQ = useMyChannel();
  const activate = useActivateChannel();
  const channel = myChannelQ.data;

  if (myChannelQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!channel) {
    return (
      <EmptyState
        title="Сначала создай канал"
        action={
          <Button asChild size="sm">
            <Link href="/studio/create">Создать канал</Link>
          </Button>
        }
      />
    );
  }

  if (channel.status === "ACTIVE") {
    return (
      <EmptyState
        title="Канал уже активирован"
        description={channel.activatedAt ? `Активирован ${timeAgo(channel.activatedAt)}.` : undefined}
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/studio">В студию</Link>
          </Button>
        }
      />
    );
  }
  if (channel.status === "SUSPENDED" || channel.status === "BANNED") {
    return <EmptyState title="Канал недоступен" description="Активация невозможна в текущем статусе." />;
  }

  function doActivate() {
    activate.mutate(channel!.id, {
      onSuccess: () => toast({ variant: "success", title: "Канал активирован" }),
      onError: (e) =>
        toast({ variant: "error", title: "Ошибка активации", description: String(e) }),
    });
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <h1 className="text-display-l text-fg">Активация канала</h1>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Одноразовый сбор</span>
          <Amount micro={ACTIVATION_FEE} className="text-h3 text-fg" />
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-fg-muted">
          <li>Донаты с текстом</li>
          <li>Публичная индексация в Discovery</li>
          <li>Оверлей и алерты для OBS</li>
        </ul>
        <p className="text-small text-fg-faint">
          Сбор невозвратный и тарифицирует атакуемую поверхность, а не существование канала. После бана
          возврат = новый кошелёк + повторный сбор.
        </p>
      </div>

      <Button variant="money" loading={activate.isPending} onClick={doActivate}>
        Активировать канал
      </Button>
    </div>
  );
}
