"use client";

import { useState } from "react";
import { ChannelFeed } from "@/components/domain/channel-feed";
import { ChannelHero } from "@/components/domain/channel-hero";
import { ChannelLinkButtons } from "@/components/domain/channel-links";
import { RealmInfo } from "@/components/domain/realm-info";
import { RealmRoll } from "@/components/domain/realm-roll";
import { ChannelGames } from "@/games/ChannelGames";
import { GameActionRail } from "@/games/GameActionRail";
import { useEscrowTasks } from "@/games/escrow-task/hooks";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useChannel,
  useChannelConfig,
  useDonations,
  useLeaderboard,
  useProfile,
  useSession,
  useStanding,
} from "@/lib/data/hooks";
import { pageWidgets } from "@/lib/page-widgets";
import { cn, pageThemeStyle, shortAddress } from "@/lib/utils";

// One shared "island" panel: rounded, hairline border, a faint top-light and a soft drop shadow so the
// card lifts off the black background instead of everything reading as one flat block.
const PANEL =
  "rounded-2xl border border-border shadow-[0_1px_1px_rgba(0,0,0,0.35),0_22px_50px_-34px_rgba(0,0,0,0.9)]";
const panelBg = { background: "linear-gradient(180deg, rgba(255,255,255,0.022), transparent 42%), var(--surface)" };

/**
 * The public realm page body — a set of distinct islands (hero · activity feed · action rail) rather than one
 * monolithic block. Keyed by `handle`; reused by the owner's preview in Personal Space. The route wraps this
 * in AppHeader + <main>; here we render only the body (loading/error/not-found included).
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

  // Owner viewing their own realm → moderation/ban is available in the feed.
  const canManage = !!address && channel?.ownerAddress === address;

  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;
  const topEntry = boardQ.data?.[0];
  const topPatron = topEntry ? (topEntry.displayName ?? shortAddress(topEntry.donor)) : null;
  // Owner's profile links — for the "socials" widget block in the rail (hero shows them too; the block is opt-in).
  const ownerLinks = useProfile(channel?.ownerAddress ?? null).data?.links ?? [];

  if (channelQ.isLoading) return <Skeleton className="mx-auto h-64 w-full max-w-[1200px] rounded-2xl" />;
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
    // Islands with gaps. The streamer's page theme (Customization → Page) provides `--realm-accent` here.
    <div
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-4"
      style={pageThemeStyle(configQ.data?.pageTheme)}
    >
      {/* Hero island */}
      <section className={cn(PANEL, "overflow-hidden")} style={panelBg}>
        <ChannelHero
          channel={channel}
          config={configQ.data}
          donorsCount={stats?.donors}
          totalDonated={stats?.total}
          topPatron={topPatron}
        />
      </section>

      {/* Body: activity on the left, action rail on the right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* Left: the feed (Games ↔ Feed tabs when the realm runs a game). */}
        <section className={cn(PANEL, "min-w-0 p-4 sm:p-5")} style={panelBg}>
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
        </section>

        {/* Right rail — sticky on desktop so Crown stays in reach. The owner's widget stack (Customization →
            Page) renders here in order: crown form / social icons / link buttons / text blocks. Roll & info
            are fixed islands below. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:self-start">
          {pageWidgets(configQ.data?.pageTheme)
            .filter((w) => w.enabled)
            .map((w) => {
              if (w.type === "donate")
                return (
                  <div key={w.id} id="crown" className="scroll-mt-20">
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
                      <Skeleton className="h-72 w-full rounded-2xl" />
                    )}
                  </div>
                );
              if (w.type === "socials")
                return ownerLinks.length > 0 ? (
                  <section key={w.id} className={cn(PANEL, "flex justify-center p-4")} style={panelBg}>
                    <ChannelLinkButtons links={ownerLinks} variant="pill" />
                  </section>
                ) : null;
              if (w.type === "button")
                return w.url ? (
                  <a
                    key={w.id}
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      PANEL,
                      "flex items-center justify-center gap-2 p-3.5 text-small font-medium text-fg transition-colors hover:border-border-strong",
                    )}
                    style={panelBg}
                  >
                    {w.label?.trim() || w.url} <ExternalLinkIcon className="h-3.5 w-3.5 text-fg-faint" />
                  </a>
                ) : null;
              // text block
              return w.text?.trim() ? (
                <section key={w.id} className={cn(PANEL, "p-4")} style={panelBg}>
                  <p className="whitespace-pre-wrap break-words text-small text-fg-muted">{w.text.trim()}</p>
                </section>
              ) : null;
            })}
          <section className={PANEL} style={panelBg}>
            <RealmRoll channelId={channel.id} handle={handle} currentAddress={address} />
          </section>
          <section className={PANEL} style={panelBg}>
            <RealmInfo
              channel={channel}
              config={configQ.data}
              currentTierName={standingQ.data?.tier?.name}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
