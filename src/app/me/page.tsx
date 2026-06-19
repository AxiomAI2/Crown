"use client";

import Link from "next/link";
import { ReputationProgress, StandingSeal, TierBadge } from "@/components/domain/standing";
import { AppHeader } from "@/components/layout/app-header";
import { Amount } from "@/components/domain/amount";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useChannel, useDiscovery, useSession, useStanding } from "@/lib/data/hooks";
import type { ChannelCard } from "@/lib/data/types";

export default function MyStandingPage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const discoveryQ = useDiscovery();

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Моё standing</h1>
          <p className="text-fg-muted">
            Репутация локальна — у тебя своё standing в каждом комьюнити, общего рейтинга нет.
          </p>
        </div>

        {sessionQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !address ? (
          <EmptyState
            title="Кошелёк не подключён"
            description="Подключи кошелёк, чтобы увидеть свой standing по каналам."
            action={
              <Button asChild size="sm">
                <Link href="/connect">Подключить кошелёк</Link>
              </Button>
            }
          />
        ) : discoveryQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex flex-col gap-3">
            {(discoveryQ.data?.items ?? []).map((card) => (
              <StandingRow key={card.channelId} card={card} address={address} />
            ))}
            <p className="text-small text-fg-faint">
              Если канал не показан — ты ещё не донатил на нём; standing появится после первого доната.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

/** Строка standing по одному каналу. Скрывается, если на канале нет истории (standing === null). */
function StandingRow({ card, address }: { card: ChannelCard; address: string }) {
  const channelQ = useChannel(card.handle);
  const channelId = channelQ.data?.id;
  const standingQ = useStanding(channelId, address);

  if (standingQ.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!standingQ.data) return null;
  const standing = standingQ.data;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <StandingSeal standing={standing} />
        <div className="flex flex-col gap-1">
          <Link href={`/c/${card.handle}`} className="font-display text-fg hover:text-status">
            @{card.handle}
          </Link>
          <TierBadge tier={standing.tier} />
          <span className="text-small text-fg-faint">
            всего задонатил <Amount micro={standing.totalDonated} />
          </span>
        </div>
      </div>
      <div className="sm:w-56">
        <ReputationProgress standing={standing} />
      </div>
    </div>
  );
}
