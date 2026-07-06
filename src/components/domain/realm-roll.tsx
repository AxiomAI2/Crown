"use client";

import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { Skeleton } from "@/components/ui/feedback";
import { useLeaderboard } from "@/lib/data/hooks";
import type { Address } from "@/lib/data/types";
import { cn, fromMicro, shortAddress } from "@/lib/utils";

const TOP_N = 5;

/** Компактная сумма для узкого рейла: "$51K", "$1.2M". */
function compactUsd(micro: bigint): string {
  return (
    "$" +
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
      fromMicro(micro),
    )
  );
}

/**
 * «Realm roll» — превью лидерборда двора (топ-5) в правом рейле: соц-пруф + живость. #1 носит 👑 (The
 * Crown), остальные — крест-бейдж ранга. Строка своей сессии подсвечена. «View all →» ведёт на полный
 * лидерборд /c/[handle]/donors. Данные — useLeaderboard (тот же ключ, что и полная страница → дедуп).
 */
export function RealmRoll({
  channelId,
  handle,
  currentAddress,
}: {
  channelId: string;
  handle: string;
  currentAddress?: Address | null;
}) {
  const { data, isLoading, error } = useLeaderboard(channelId, "all_time");
  const top = (data ?? []).slice(0, TOP_N);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption uppercase tracking-wide text-fg-faint">Realm roll</h3>
        <Link
          href={`/c/${handle}/donors`}
          className="text-caption text-fg-faint transition-colors hover:text-fg"
        >
          View all →
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-small text-fg-faint">Couldn&apos;t load the roll.</p>
      ) : top.length === 0 ? (
        <p className="text-small text-fg-muted">No crowns yet — be the first.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {top.map((e, i) => (
            <li key={e.donor}>
              <Link
                href={`/u/${e.donor}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised",
                  e.donor === currentAddress && "bg-status-bg",
                )}
              >
                <span className="mono w-3 shrink-0 text-caption text-fg-faint">{i + 1}</span>
                {i === 0 ? (
                  <span
                    className="animate-crown grid h-6 w-6 flex-none place-items-center text-small"
                    aria-hidden
                  >
                    👑
                  </span>
                ) : (
                  <RankBadge points={e.points} size={24} />
                )}
                <span className="min-w-0 flex-1 truncate text-small text-fg">
                  {e.displayName ?? shortAddress(e.donor)}
                </span>
                <span className="mono shrink-0 text-small text-fg-muted">
                  {compactUsd(e.totalDonated)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
