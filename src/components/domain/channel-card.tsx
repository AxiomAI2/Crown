import Link from "next/link";
import type { ChannelCard } from "@/lib/data/types";

/** Карточка канала в Discovery. */
export function ChannelCardTile({ card }: { card: ChannelCard }) {
  return (
    <Link
      href={`/c/${card.handle}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors duration-fast ease-ease hover:border-border-strong"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface-raised font-display text-fg">
          {card.handle.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-fg">@{card.handle}</div>
          {card.displayName ? (
            <div className="truncate text-small text-fg-faint">{card.displayName}</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between text-small text-fg-muted">
        <span className="mono">{card.donorsCount} донатеров</span>
        <span className="text-status">{card.topTierName}</span>
      </div>
    </Link>
  );
}
