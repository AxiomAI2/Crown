"use client";

import { useParams } from "next/navigation";
import { DonateWidget } from "@/components/domain/donate";
import { DonationHistory } from "@/components/domain/donation-history";
import { Leaderboard } from "@/components/domain/leaderboard";
import { ReputationProgress, StandingSeal, TierLadder } from "@/components/domain/standing";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
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

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-content px-4 py-8">
        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : channelQ.error ? (
          <ErrorState description="Не удалось загрузить канал." onRetry={() => channelQ.refetch()} />
        ) : !channel ? (
          <EmptyState title="Канал не найден" description={`Канала @${handle} не существует.`} />
        ) : channel.status === "SUSPENDED" || channel.status === "BANNED" ? (
          <EmptyState
            title="Канал недоступен"
            description="Этот канал приостановлен. Если это ошибка — обратись в поддержку."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-display-l text-fg">@{channel.handle}</h1>
              {channel.status === "BASIC" ? (
                <span className="rounded-pill border border-border px-2 py-0.5 text-small text-fg-faint">
                  не активирован
                </span>
              ) : null}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Левая колонка — контент канала */}
              <div className="flex flex-col gap-8">
                <section className="flex flex-col gap-3">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-12 w-full rounded-lg" />
                  ) : (
                    <DonationHistory
                      donations={(donationsQ.data?.items ?? []).filter(
                        (d) => d.message?.state === "SHOWN",
                      )}
                      title="Лента (показанные сообщения)"
                      reportable
                      defaultOpen
                    />
                  )}
                </section>

                <section className="flex flex-col gap-3">
                  <h2 className="text-h2 text-fg">Лидерборд</h2>
                  {channel ? <Leaderboard channelId={channel.id} currentAddress={address} /> : null}
                </section>

                <section className="flex flex-col gap-3">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-12 w-full rounded-lg" />
                  ) : (
                    <DonationHistory donations={donationsQ.data?.items ?? []} />
                  )}
                </section>

                <section className="flex flex-col gap-3">
                  <h2 className="text-h2 text-fg">Тиры канала</h2>
                  {configQ.data ? <TierLadder tiers={configQ.data.tiers} /> : <Skeleton className="h-40 w-full" />}
                </section>
              </div>

              {/* Правая колонка — моё standing + донат */}
              <aside className="flex flex-col gap-6">
                <section className="flex flex-col gap-3">
                  <h2 className="text-h3 text-fg">Моё standing</h2>
                  {!address ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
                      <p className="text-small text-fg-muted">
                        Подключи кошелёк, чтобы видеть и набирать standing на этом канале.
                      </p>
                      <ConnectWalletButton />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <StandingSeal
                        standing={standingQ.data}
                        fallbackTier={configQ.data?.tiers[0]}
                        loading={standingQ.isLoading || configQ.isLoading}
                      />
                      {standingQ.data ? <ReputationProgress standing={standingQ.data} /> : null}
                      {!standingQ.isLoading && !standingQ.data ? (
                        <p className="text-small text-fg-muted">
                          Сделай первый донат, чтобы начать набирать standing.
                        </p>
                      ) : null}
                    </div>
                  )}
                </section>

                {configQ.data && sessionQ.data ? (
                  <DonateWidget channel={channel} config={configQ.data} session={sessionQ.data} />
                ) : (
                  <Skeleton className="h-72 w-full rounded-lg" />
                )}
              </aside>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
