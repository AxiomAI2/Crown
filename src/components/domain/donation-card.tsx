import { Amount } from "./amount";
import { TierBadge } from "./standing";
import { shortAddress, timeAgo } from "@/lib/utils";
import type { Donation, Tier } from "@/lib/data/types";

/** Карточка доната: донор, бейдж тира, сумма, текст (если SHOWN), время. Лента канала и история /me. */
export function DonationCard({
  donation,
  tier,
  displayName,
  showChannel,
}: {
  donation: Donation;
  tier?: Tier;
  displayName?: string;
  showChannel?: boolean;
}) {
  const shown = donation.message?.state === "SHOWN";
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-small text-fg">
            {displayName ?? shortAddress(donation.donor)}
          </span>
          {tier ? <TierBadge tier={tier} /> : null}
        </div>
        <Amount micro={donation.amount} />
      </div>
      {shown && donation.message ? (
        <p className="text-body text-fg">{donation.message.text}</p>
      ) : null}
      <div className="flex items-center gap-2 text-small text-fg-faint">
        <span title={donation.ts}>{timeAgo(donation.ts)}</span>
        {showChannel ? <span className="mono">· {donation.channelId}</span> : null}
      </div>
    </div>
  );
}
