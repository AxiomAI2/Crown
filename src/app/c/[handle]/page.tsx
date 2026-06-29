"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ChannelHeader } from "@/components/domain/channel-header";
import { DonateWidget } from "@/components/domain/donate";
import { DonationHistory } from "@/components/domain/donation-history";
import { TierLadder } from "@/components/domain/standing";
import { ChannelGames, ChannelGameRail } from "@/games/ChannelGames";
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

  // Игры на канале: «Игры» — первая вкладка и активна ПО УМОЛЧАНИЮ (если включены). Контролируемые табы,
  // чтобы правый рейл мог меняться под выбранную игру. tabState=null → дефолт (games при наличии игр).
  const enabledGames = configQ.data?.enabledGames ?? [];
  const hasGames = enabledGames.length > 0;
  const [tabState, setTabState] = useState<string | null>(null);
  const activeTab = tabState ?? (hasGames ? "games" : "feed");
  const [selGame, setSelGame] = useState<string | null>(null);
  const selectedGame = selGame ?? enabledGames[0] ?? null;

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
          // (row-span-2, rail-pinned). gap-x-6 = прежний зазор между колонками; gap-y-8 = прежний зазор шапка↔лента.
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-x-6 lg:gap-y-8">
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
              {activeTab === "games" && hasGames && selectedGame ? (
                // На вкладке «Игры» рейл — действие выбранной игры (морфинг под игру).
                <ChannelGameRail
                  gameId={selectedGame}
                  channelId={channel.id}
                  ownerAddress={channel.ownerAddress}
                  handle={handle}
                />
              ) : configQ.data && sessionQ.data ? (
                <DonateWidget
                  channel={channel}
                  config={configQ.data}
                  session={sessionQ.data}
                  standing={standingQ.data}
                  standingLoading={standingQ.isLoading}
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
                  {hasGames ? <TabsTrigger value="games">Игры</TabsTrigger> : null}
                  <TabsTrigger value="feed">Лента</TabsTrigger>
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
                      selectedGame={selectedGame}
                      onSelect={setSelGame}
                    />
                  </TabsContent>
                ) : null}

                <TabsContent value="feed">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : (
                    <DonationHistory
                      donations={(donationsQ.data?.items ?? []).filter(
                        (d) => d.message?.state === "SHOWN",
                      )}
                      title="Показанные сообщения"
                      reportable
                      plain
                      manageChannelId={canManage ? channel.id : undefined}
                    />
                  )}
                </TabsContent>

                <TabsContent value="donations">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : (
                    <DonationHistory
                      donations={donationsQ.data?.items ?? []}
                      collapsible={false}
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
