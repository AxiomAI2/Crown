"use client";

import Link from "next/link";
import { Amount } from "./amount";
import { DonationCard } from "./donation-card";
import { ReputationProgress, StandingSeal, TierBadge } from "./standing";
import { Skeleton } from "@/components/ui/feedback";
import { useDiscovery, useDonations, useStanding } from "@/lib/data/hooks";
import type { ChannelCard } from "@/lib/data/types";
import { channelHue } from "@/lib/utils";

/** Аватар профиля: монограмма со стабильным цветом по имени/адресу (картинок нет — §профиль). */
export function ProfileAvatar({ name, address }: { name?: string; address: string }) {
  const seed = name?.trim() || address;
  const initial = seed.replace(/^@/, "").slice(0, 1).toUpperCase();
  const hue = channelHue(seed);
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-h3"
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
    >
      {initial}
    </div>
  );
}

/** Строка standing по одному каналу + сворачиваемая история донатов донора. Скрыта, если standing === null. */
function StandingRow({ card, address }: { card: ChannelCard; address: string }) {
  const standingQ = useStanding(card.channelId, address);
  const donationsQ = useDonations(card.channelId);

  if (standingQ.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!standingQ.data) return null;
  const standing = standingQ.data;
  const theirDonations = (donationsQ.data?.items ?? []).filter((d) => d.donor === address);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <StandingSeal standing={standing} />
          <div className="flex flex-col gap-1">
            <Link href={`/c/${card.handle}`} className="font-display text-fg hover:text-status">
              @{card.handle}
            </Link>
            {standing.tier ? <TierBadge tier={standing.tier} /> : null}
            <span className="text-small text-fg-faint">
              всего задонатил <Amount micro={standing.totalDonated} />
            </span>
          </div>
        </div>
        <div className="sm:w-56">
          <ReputationProgress standing={standing} />
        </div>
      </div>

      {theirDonations.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-small text-fg-muted hover:text-fg">
            История донатов ({theirDonations.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {theirDonations.map((d) => (
              <DonationCard key={d.id} donation={d} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Standing донора по всем каналам, где он донатил (каналы без standing скрыты). Общий для /me и /u/[address]. */
export function ChannelStandingList({ address }: { address: string }) {
  const discoveryQ = useDiscovery();
  if (discoveryQ.isLoading) return <Skeleton className="h-32 w-full" />;
  return (
    <div className="flex flex-col gap-3">
      {(discoveryQ.data?.items ?? []).map((card) => (
        <StandingRow key={card.channelId} card={card} address={address} />
      ))}
      <p className="text-small text-fg-faint">
        Каналы без standing скрыты — они появляются после первого доната.
      </p>
    </div>
  );
}
