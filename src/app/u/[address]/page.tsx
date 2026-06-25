"use client";

import { useParams } from "next/navigation";
import { ChannelStandingList, ProfileAvatar } from "@/components/domain/standing-list";
import { AppHeader } from "@/components/layout/app-header";
import { useProfile } from "@/lib/data/hooks";

/** Публичный профиль донатера (read-only): личность + standing по каналам. Сюда ведут клики из лидерборда. */
export default function PublicProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address ? decodeURIComponent(params.address) : "";
  const profileQ = useProfile(address || null);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
          <ProfileAvatar name={profileQ.data?.displayName} address={address} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-display text-h3 text-fg">
              {profileQ.data?.displayName ?? "Профиль донатера"}
            </span>
            <span className="mono truncate text-small text-fg-faint">{address}</span>
            {profileQ.data?.bio ? (
              <p className="text-small text-fg-muted">{profileQ.data.bio}</p>
            ) : null}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-fg">Standing по каналам</h2>
          <ChannelStandingList address={address} />
        </section>
      </main>
    </>
  );
}
