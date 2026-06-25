"use client";

import Link from "next/link";
import { ChannelStandingList, ProfileAvatar } from "@/components/domain/standing-list";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useProfile, useSession } from "@/lib/data/hooks";

export default function ProfilePage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const profileQ = useProfile(address);

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
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <ProfileAvatar name={profileQ.data?.displayName} address={address} />
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

            <section className="flex flex-col gap-3">
              <h2 className="text-h2 text-fg">Моё standing</h2>
              <ChannelStandingList address={address} />
            </section>
          </>
        )}
      </main>
    </>
  );
}
