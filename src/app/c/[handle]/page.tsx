"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ChannelFeed } from "@/components/domain/channel-feed";
import { ChannelHeader } from "@/components/domain/channel-header";
import { TierLadder } from "@/components/domain/standing";
import { ChannelGames } from "@/games/ChannelGames";
import { GameActionRail } from "@/games/GameActionRail";
import { useEscrowTasks } from "@/games/escrow-task/hooks";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useChannel,
  useChannelConfig,
  useDonations,
  useSession,
  useStanding,
} from "@/lib/data/hooks";

export default function ChannelPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;

  const channelQ = useChannel(handle);
  const channel = channelQ.data;
  const configQ = useChannelConfig(channel?.id);
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const standingQ = useStanding(channel?.id, address);
  const donationsQ = useDonations(channel?.id);

  // Игры на канале: таб «Активные» (активные партии) — первый при наличии игр. Выбор игры/донат перенесён в
  // правый рейл (GameActionRail), поэтому табы больше не управляют рейлом. tabState=null → дефолт.
  const enabledGames = configQ.data?.enabledGames ?? [];
  const hasGames = enabledGames.length > 0;
  // Донаты-с-заданиями (игра escrow-task) вливаем в общую ленту «Донаты». Читаем ВСЕГДА (не зависит от того,
  // включена ли игра сейчас): выключение режима не должно стирать связанные донаты из ленты — это история.
  const escrowTasks = useEscrowTasks(channel?.id).data?.tasks ?? [];
  const [tabState, setTabState] = useState<string | null>(null);
  const activeTab = tabState ?? (hasGames ? "games" : "donations");

  // Владелец, смотрящий свой канал → в ленте доступна кнопка «Забанить» (модераторы банят из студии/очереди).
  const canManage = !!address && channel?.ownerAddress === address;

  // Статистика для большой шапки (из загруженных донатов; уникальные донатёры + сумма).
  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-content px-4 pb-8 pt-4">
        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : channelQ.error ? (
          <ErrorState
            description="Не удалось загрузить канал."
            onRetry={() => channelQ.refetch()}
          />
        ) : !channel ? (
          <EmptyState title="Канал не найден" description={`Канала @${handle} не существует.`} />
        ) : channel.status === "SUSPENDED" || channel.status === "BANNED" ? (
          <EmptyState
            title="Канал недоступен"
            description="Этот канал приостановлен. Если это ошибка — обратись в поддержку."
          />
        ) : (
          // На мобиле — поток: шапка → донат → лента (главное действие сразу под шапкой, не внизу страницы).
          // На lg — грид [1fr_360px]: шапка/лента в левой колонке (строки 1 и 2), донат закреплён справа
          // (row-span-2, rail-pinned). Строки [auto_1fr]: шапка (row 1 = auto) НЕ растягивается, когда правый
          // рейл выше левой колонки (напр. высокая форма задания) — избыток высоты уходит в row 2 (под ленту),
          // а не в зазор под шапкой. gap-x-6 — зазор колонок; gap-y-8 — зазор шапка↔лента.
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_360px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-6 lg:gap-y-8">
            {/* Шапка канала. min-w-0: длинные ники/mono-адреса не должны раздувать 1fr-трек шире вьюпорта,
                иначе страница становится шире экрана и правый блок хедера («Войти») уезжает за край. */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <ChannelHeader
                channel={channel}
                config={configQ.data}
                donorsCount={stats?.donors}
                totalDonated={stats?.total}
              />
            </div>

            {/* Донат + моё standing. На мобиле — СРАЗУ под шапкой (в потоке вторым). На lg — правая колонка,
                ФИКСИРОВАНА при скролле (rail-pinned-right), занимает обе строки правого трека (row-span-2). */}
            <aside className="rail-pinned-right flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              {configQ.data && sessionQ.data ? (
                // Рейл действия: по умолчанию форма доната; «другие игры» → пикер → форма выбранной игры.
                <GameActionRail
                  channel={channel}
                  config={configQ.data}
                  session={sessionQ.data}
                  standing={standingQ.data}
                  standingLoading={standingQ.isLoading}
                  handle={handle}
                  enabledGames={enabledGames}
                />
              ) : (
                <Skeleton className="h-72 w-full rounded-lg" />
              )}
            </aside>

            {/* Контент канала — табами (мини-хедер), а не простынёй. Новые фичи = новая вкладка.
                На мобиле идёт после доната; на lg — левая колонка под шапкой (строка 2). */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              <Tabs value={activeTab} onValueChange={setTabState} className="flex flex-col gap-1">
                <TabsList className="w-full">
                  {hasGames ? <TabsTrigger value="games">Активные</TabsTrigger> : null}
                  <TabsTrigger value="donations">Донаты</TabsTrigger>
                  <TabsTrigger value="tiers">Тиры</TabsTrigger>
                </TabsList>

                {hasGames ? (
                  <TabsContent value="games">
                    <ChannelGames
                      channelId={channel.id}
                      ownerAddress={channel.ownerAddress}
                      handle={handle}
                      enabledGames={enabledGames}
                    />
                  </TabsContent>
                ) : null}

                <TabsContent value="donations">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : (
                    <ChannelFeed
                      donations={donationsQ.data?.items ?? []}
                      tasks={escrowTasks}
                      handle={handle}
                      reportable
                      manageChannelId={canManage ? channel.id : undefined}
                    />
                  )}
                </TabsContent>

                <TabsContent value="tiers">
                  {configQ.data ? (
                    <TierLadder tiers={configQ.data.tiers} />
                  ) : (
                    <Skeleton className="h-40 w-full" />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
