"use client";

import { useMemo, useState } from "react";
import { Amount } from "@/components/domain/amount";
import { CumulativeAreaChart, RangeTabs, type ChartRange } from "@/components/domain/area-chart";
import { CreateChannelForm } from "@/components/domain/create-channel-form";
import { DonationHistory } from "@/components/domain/donation-history";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useDonations, useMyChannel, useSession } from "@/lib/data/hooks";
import { fromMicro, plural } from "@/lib/utils";

const DONORS = ["донатёр", "донатёра", "донатёров"] as const;
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StudioDashboardPage() {
  const sessionQ = useSession();
  const myChannelQ = useMyChannel();
  const channel = myChannelQ.data;
  const donationsQ = useDonations(channel?.id);
  const [range, setRange] = useState<ChartRange>("ALL");

  const donations = useMemo(() => donationsQ.data?.items ?? [], [donationsQ.data?.items]);

  // События для графиков: оборот (v = сумма в USDC) и новые донатёры (первый донат каждого, v = 1).
  const turnoverEvents = useMemo(
    () => donations.map((d) => ({ t: Date.parse(d.ts), v: fromMicro(d.amount) })),
    [donations],
  );
  const donorEvents = useMemo(() => {
    const firstByDonor = new Map<string, number>();
    for (const d of donations) {
      const t = Date.parse(d.ts);
      const prev = firstByDonor.get(d.donor);
      if (prev === undefined || t < prev) firstByDonor.set(d.donor, t);
    }
    return [...firstByDonor.values()].map((t) => ({ t, v: 1 }));
  }, [donations]);

  if (sessionQ.isLoading || myChannelQ.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (myChannelQ.error) {
    return <ErrorState description="Не удалось загрузить канал." onRetry={() => myChannelQ.refetch()} />;
  }
  if (!sessionQ.data?.address) {
    return (
      <EmptyState
        title="Подключи кошелёк"
        description="Студия доступна после подключения кошелька."
        action={<ConnectWalletButton />}
      />
    );
  }
  if (!channel) {
    // Канала нет → форма создания прямо здесь (отдельной страницы /studio/create больше нет).
    return <CreateChannelForm />;
  }

  const turnover = donations.reduce((s, d) => s + d.amount, 0n);
  const donorsCount = donorEvents.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-display-l text-fg">@{channel.handle}</h1>
        <span className="mono text-caption text-fg-faint">{channel.status}</span>
      </div>

      {/* Аналитика: графики в стиле профиля (кумулятивная area-диаграмма с наведением). */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h2 text-fg">Аналитика</h2>
        <RangeTabs range={range} onChange={setRange} />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ChartCard
          title="Оборот"
          headline={<Amount micro={turnover} variant="money" className="text-display-l" />}
        >
          <CumulativeAreaChart
            events={turnoverEvents}
            range={range}
            formatValue={usd}
            emptyHint="Оборот появится после первого доната."
          />
        </ChartCard>
        <ChartCard
          title="Донатёры"
          headline={
            <span className="font-display text-display-l text-fg">
              {donorsCount} <span className="text-h3 text-fg-muted">{plural(donorsCount, DONORS)}</span>
            </span>
          }
        >
          <CumulativeAreaChart
            events={donorEvents}
            range={range}
            color="var(--info)"
            formatValue={(v) => `${Math.round(v)} ${plural(Math.round(v), DONORS)}`}
            emptyHint="Донатёры появятся после первого доната."
          />
        </ChartCard>
      </div>

      <section className="flex flex-col gap-3">
        {donationsQ.isLoading ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : (
          <DonationHistory donations={donations} manageChannelId={channel.id} />
        )}
      </section>
    </div>
  );
}

function ChartCard({
  title,
  headline,
  children,
}: {
  title: string;
  headline: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <span className="text-small text-fg-muted">{title}</span>
      <div className="break-words">{headline}</div>
      {children}
    </div>
  );
}
