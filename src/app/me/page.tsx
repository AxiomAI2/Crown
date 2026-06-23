"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { DonationCard } from "@/components/domain/donation-card";
import { ReputationProgress, StandingSeal, TierBadge } from "@/components/domain/standing";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useDiscovery, useDonations, useProfile, useSession, useStanding } from "@/lib/data/hooks";
import type { ChannelCard } from "@/lib/data/types";

export default function ProfilePage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const profileQ = useProfile(address);
  const discoveryQ = useDiscovery();

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        {sessionQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !address ? (
          <EmptyState
            title="Кошелёк не подключён"
            description="Подключи кошелёк, чтобы увидеть свой профиль и standing."
            action={<ConnectWalletButton />}
          />
        ) : (
          <>
            {/* Шапка профиля + отдельная кнопка редактирования */}
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <ProfileAvatar
                  url={profileQ.data?.avatarUrl}
                  name={profileQ.data?.displayName}
                  address={address}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-display text-h3 text-fg">
                    {profileQ.data?.displayName ?? "Без имени"}
                  </span>
                  <span className="mono truncate text-small text-fg-faint">{address}</span>
                  {profileQ.data?.bio ? (
                    <p className="text-small text-fg-muted">{profileQ.data.bio}</p>
                  ) : null}
                </div>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href="/me/profile">Редактировать профиль</Link>
              </Button>
            </div>

            {/* Репутация по каналам + история донатов (по всем каналам) */}
            <section className="flex flex-col gap-3">
              <h2 className="text-h2 text-fg">Моё standing</h2>
              {discoveryQ.isLoading ? (
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
            </section>
          </>
        )}
      </main>
    </>
  );
}

/** Аватар профиля: картинка по URL или монограмма-плейсхолдер. */
function ProfileAvatar({ url, name, address }: { url?: string; name?: string; address: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- аватар по произвольному URL пользователя
    return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />;
  }
  const initial = (name ?? address).slice(0, 1).toUpperCase();
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-h3 text-fg-muted">
      {initial}
    </div>
  );
}

/** Строка standing по одному каналу + сворачиваемая история донатов. Скрывается, если standing === null. */
function StandingRow({ card, address }: { card: ChannelCard; address: string }) {
  const standingQ = useStanding(card.channelId, address);
  const donationsQ = useDonations(card.channelId);

  if (standingQ.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!standingQ.data) return null;
  const standing = standingQ.data;
  const myDonations = (donationsQ.data?.items ?? []).filter((d) => d.donor === address);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

      {myDonations.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-small text-fg-muted hover:text-fg">
            История донатов ({myDonations.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {myDonations.map((d) => (
              <DonationCard key={d.id} donation={d} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
