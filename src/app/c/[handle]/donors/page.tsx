"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Leaderboard } from "@/components/domain/leaderboard";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useChannel, useSession } from "@/lib/data/hooks";

/** Страница донатеров канала: лидерборд с сортировкой (standing / сумма / тир), клик по строке → профиль. */
export default function DonorsPage() {
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
            ← Канал @{handle}
          </Link>
          <h1 className="text-display-l text-fg">Донатеры</h1>
        </div>

        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : !channel ? (
          <EmptyState title="Канал не найден" description={`Канала @${handle} не существует.`} />
        ) : (
          <Leaderboard channelId={channel.id} currentAddress={address} />
        )}
      </main>
    </>
  );
}
