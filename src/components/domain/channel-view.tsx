"use client";

import { useState } from "react";
import { ChannelFeed } from "@/components/domain/channel-feed";
import { ChannelHero } from "@/components/domain/channel-hero";
import { RealmInfo } from "@/components/domain/realm-info";
import { RealmRoll } from "@/components/domain/realm-roll";
import { ReignStrip } from "@/components/domain/reign-strip";
import { ChannelGames } from "@/games/ChannelGames";
import { GameActionRail } from "@/games/GameActionRail";
import { useEscrowTasks } from "@/games/escrow-task/hooks";
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
import { pageThemeStyle, shortAddress } from "@/lib/utils";

/**
 * The public realm page body — hero · Reign strip · Games/Feed · Crown-action sidebar — keyed by `handle`.
 * Extracted from the `/c/[handle]` route so it can be reused: the owner previews their own realm inside
 * Personal Space → My Realm ("Realm page"), seeing exactly what visitors get. The route wraps this in
 * AppHeader + <main>; here we render only the body (loading/error/not-found included).
 */
export function ChannelView({ handle }: { handle: string }) {
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

  // Owner viewing their own realm → moderation/ban is available in the feed (moderators — from the studio/queue).
  const canManage = !!address && channel?.ownerAddress === address;

  // Stats for the hero (from loaded Crowns) + The Crown (leaderboard top-1).
  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;
  const topEntry = boardQ.data?.[0];
  const topPatron = topEntry ? (topEntry.displayName ?? shortAddress(topEntry.donor)) : null;

  if (channelQ.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (channelQ.error)
    return <ErrorState description="Couldn't load the realm." onRetry={() => channelQ.refetch()} />;
  if (!channel) return <EmptyState title="Realm not found" description={`No realm @${handle} exists.`} />;
  if (channel.status === "SUSPENDED" || channel.status === "BANNED")
    return (
      <EmptyState
        title="Realm unavailable"
        description="This realm is suspended. If this is a mistake, contact support."
      />
    );

  return (
    // The whole page is ONE block: an outer frame with flat sections inside, separated by thin dividers (no
    // "islands"). The only raised card inside is the Crown widget (the action).
    // Streamer's page theme (Customization → Page) styles THIS card (bg + `--realm-accent`); undefined → default look.
    <div
      className="mx-auto w-full max-w-[1200px] overflow-hidden rounded-2xl border border-border bg-surface"
      style={pageThemeStyle(configQ.data?.pageTheme)}
    >
      {/* Section: hero */}
      <div className="border-b border-border">
        <ChannelHero
          channel={channel}
          config={configQ.data}
          donorsCount={stats?.donors}
          totalDonated={stats?.total}
          topPatron={topPatron}
        />
      </div>

      {/* Section: your Reign (full-width strip). */}
      <div className="border-b border-border">
        <ReignStrip standing={standingQ.data} loading={standingQ.isLoading} />
      </div>

      {/* Body: live feed on the left, sidebar on the right (Crown → leaderboard → reference). Separated
          by a vertical hairline; the sidebar sections — by horizontal ones. All in a shared frame. */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Center: activity. Tabs only when there are games (Games ↔ Feed); otherwise just Feed. */}
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

        {/* Sidebar: Crown action → leaderboard → realm reference, sections separated by dividers. */}
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
  );
}
