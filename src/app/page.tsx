"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useHomeFeed, useSession } from "@/lib/data/hooks";
import type { LiveChannel, OpenCycle } from "@/lib/data/types";
import { cn, collapseWhitespace, plural } from "@/lib/utils";

/**
 * Главная — личная домашняя база (ADR 0018), НЕ каталог каналов. Два состояния:
 *  есть свои циклы → дашборд по срочности; своего нет → срез живого; ни того ни другого → честное пустое.
 * Discovery-грид понижен на `/discovery`.
 */
export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <Home />
      </main>
    </>
  );
}

const KIND: Record<OpenCycle["kind"], { label: string; hot: boolean }> = {
  claimable: { label: "Забрать возврат", hot: true },
  grace: { label: "Можно отменить", hot: true },
  dispute_window: { label: "Оспорить или подождать", hot: true },
  voting: { label: "Идёт голосование", hot: false },
  awaiting: { label: "В работе", hot: false },
};

/** Относительная подсказка по дедлайну (не тикер — пересчитывается при рефетче). */
function deadlineHint(iso?: string): string {
  if (!iso) return "доступно сейчас";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "истекает";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `≈ ${min} ${plural(min, ["минута", "минуты", "минут"])}`;
  const h = Math.round(min / 60);
  if (h < 48) return `≈ ${h} ${plural(h, ["час", "часа", "часов"])}`;
  const d = Math.round(h / 24);
  return `≈ ${d} ${plural(d, ["день", "дня", "дней"])}`;
}

function CycleCard({ c }: { c: OpenCycle }) {
  const k = KIND[c.kind];
  return (
    <Link
      href={`/c/${c.channelHandle}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-pill border px-2 py-0.5 text-small",
            k.hot ? "border-money text-money" : "border-border text-fg-muted",
          )}
        >
          {k.label}
        </span>
        <Amount micro={c.amount} variant="money" />
      </div>
      <p className="line-clamp-2 text-body text-fg">{collapseWhitespace(c.text)}</p>
      <div className="flex items-center justify-between text-small text-fg-faint">
        <span className="mono">@{c.channelHandle}</span>
        <span>{deadlineHint(c.deadline)}</span>
      </div>
    </Link>
  );
}

function LiveCard({ l }: { l: LiveChannel }) {
  return (
    <Link
      href={`/c/${l.handle}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="mono text-fg">@{l.handle}</span>
        <Amount micro={l.lockedMicro} />
      </div>
      <div className="text-small text-fg-muted">
        {l.activeCount} {plural(l.activeCount, ["задание", "задания", "заданий"])} · {l.participants}{" "}
        {plural(l.participants, ["участник", "участника", "участников"])}
      </div>
    </Link>
  );
}

function DiscoveryLink() {
  return (
    <Link href="/discovery" className="text-small text-fg-muted hover:text-fg">
      Смотреть все каналы →
    </Link>
  );
}

function Home() {
  const { data, isLoading, error, refetch } = useHomeFeed();
  const address = useSession().data?.address ?? null;

  if (isLoading) return <Skeleton className="h-28 w-full rounded-lg" />;
  if (error)
    return <ErrorState description="Не удалось загрузить главную." onRetry={() => refetch()} />;

  const cycles = data?.cycles ?? [];
  const live = data?.live ?? [];

  if (cycles.length > 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Требует тебя</h1>
          <p className="text-fg-muted">Твои открытые циклы — по срочности.</p>
        </div>
        <div className="flex flex-col gap-3">
          {cycles.map((c) => (
            <CycleCard key={c.taskId} c={c} />
          ))}
        </div>
        <DiscoveryLink />
      </div>
    );
  }

  if (live.length > 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Прямо сейчас</h1>
          <p className="text-fg-muted">Где кипит — по числу разных участников.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((l) => (
            <LiveCard key={l.channelId} l={l} />
          ))}
        </div>
        <DiscoveryLink />
      </div>
    );
  }

  // Вырожденное: ни своего, ни живого (§7 — честное пустое, не грид, не фейк).
  return (
    <EmptyState
      title="Пока тихо"
      description={
        address
          ? "Нет открытых циклов и ничего живого. Загляни в каналы."
          : "Подключи кошелёк — здесь будут твои открытые циклы."
      }
      action={
        address ? (
          <Link
            href="/discovery"
            className="rounded-md border border-border px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            Смотреть каналы →
          </Link>
        ) : (
          <ConnectWalletButton />
        )
      }
    />
  );
}
