"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Leaderboard } from "@/components/domain/leaderboard";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useChannel, useSession } from "@/lib/data/hooks";

/** Realm supporters page (leaderboard): sorting (Reign / amount) + tier filter; click a row → profile.
 *  One name for this surface everywhere — "Supporters" (rail label, page title, URL). */
export default function SupportersPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;
  const channelQ = useChannel(handle);
  const channel = channelQ.data;
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1">
          <Link href={`/c/${handle}`} className="w-fit text-small text-fg-faint hover:text-fg">
            ← Realm @{handle}
          </Link>
          <h1 className="text-display-l text-fg">Supporters</h1>
        </div>

        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : !channel ? (
          <EmptyState title="Realm not found" description={`Realm @${handle} doesn't exist.`} />
        ) : (
          <Leaderboard channelId={channel.id} currentAddress={address} />
        )}
      </main>
    </>
  );
}
