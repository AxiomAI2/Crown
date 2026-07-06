"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ChannelFeed } from "@/components/domain/channel-feed";
import { ChannelHero } from "@/components/domain/channel-hero";
import { RealmInfo } from "@/components/domain/realm-info";
import { RealmRoll } from "@/components/domain/realm-roll";
import { ReignStrip } from "@/components/domain/reign-strip";
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
  useLeaderboard,
  useSession,
  useStanding,
} from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

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
  const escrowTasks = useEscrowTasks(channel?.id).data?.tasks ?? [];
  const boardQ = useLeaderboard(channel?.id, "all_time");

  const enabledGames = configQ.data?.enabledGames ?? [];
  const hasGames = enabledGames.length > 0;
  const [tabState, setTabState] = useState<string | null>(null);
  const activeTab = tabState ?? (hasGames ? "games" : "feed");

  // Владелец, смотрящий свой двор → в ленте доступна модерация/бан (модераторы — из студии/очереди).
  const canManage = !!address && channel?.ownerAddress === address;

  // Статистика для героя (из загруженных донатов) + The Crown (топ-1 лидерборда).
  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;
  const topEntry = boardQ.data?.[0];
  const topPatron = topEntry ? (topEntry.displayName ?? shortAddress(topEntry.donor)) : null;

  return (
    <>
      <AppHeader />
      <main className="w-full px-4 pb-10 pt-4 lg:px-6">
        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : channelQ.error ? (
          <ErrorState description="Couldn't load the realm." onRetry={() => channelQ.refetch()} />
        ) : !channel ? (
          <EmptyState title="Realm not found" description={`No realm @${handle} exists.`} />
        ) : channel.status === "SUSPENDED" || channel.status === "BANNED" ? (
          <EmptyState
            title="Realm unavailable"
            description="This realm is suspended. If this is a mistake, contact support."
          />
        ) : (
          // Вся страница — ОДИН блок: внешняя рамка, внутри плоские секции через тонкие разделители (без
          // «островов»). Единственная выпуклая карточка внутри — донат-виджет (действие).
          <div className="mx-auto w-full max-w-[1200px] overflow-hidden rounded-2xl border border-border bg-surface">
            {/* Секция: hero */}
            <div className="border-b border-border">
              <ChannelHero
                channel={channel}
                config={configQ.data}
                donorsCount={stats?.donors}
                totalDonated={stats?.total}
                topPatron={topPatron}
              />
            </div>

            {/* Секция: твой Reign (полоса на всю ширину). */}
            <div className="border-b border-border">
              <ReignStrip standing={standingQ.data} loading={standingQ.isLoading} />
            </div>

            {/* Тело: слева живая лента, справа сайдбар (Crown → лидерборд → справочник). Разделены
                вертикальной волосяной линией; секции сайдбара — горизонтальными. Всё в общей рамке. */}
            <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* Центр: активность. Табы — только когда есть игры (Games ↔ Feed); иначе просто Feed. */}
              <div className="min-w-0 p-4 sm:p-5">
                <Tabs value={activeTab} onValueChange={setTabState} className="flex flex-col gap-3">
                  {hasGames ? (
                    <TabsList className="w-full">
                      <TabsTrigger value="games">Games</TabsTrigger>
                      <TabsTrigger value="feed">Feed</TabsTrigger>
                    </TabsList>
                  ) : null}

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

                  <TabsContent value="feed">
                    {donationsQ.isLoading ? (
                      <Skeleton className="h-24 w-full rounded-lg" />
                    ) : (
                      <ChannelFeed
                        donations={allDonations}
                        tasks={escrowTasks}
                        handle={handle}
                        channelId={channel.id}
                        reportable
                        manageChannelId={canManage ? channel.id : undefined}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Сайдбар: действие Crown → лидерборд → справочник двора, секции через разделители. */}
              <aside
                id="crown"
                className="flex scroll-mt-20 flex-col border-t border-border lg:border-l lg:border-t-0"
              >
                <div className="p-4">
                  {configQ.data && sessionQ.data ? (
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
                </div>
                <div className="border-t border-border">
                  <RealmRoll channelId={channel.id} handle={handle} currentAddress={address} />
                </div>
                <div className="border-t border-border">
                  <RealmInfo
                    channel={channel}
                    config={configQ.data}
                    currentTierName={standingQ.data?.tier?.name}
                  />
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
