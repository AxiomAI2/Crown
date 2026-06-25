import { Amount } from "./amount";
import { ModerationMenu } from "./moderation-menu";
import { ReportDialog } from "./report-dialog";
import { TierBadge } from "./standing";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { shortAddress, timeAgo } from "@/lib/utils";
import type { Donation, Tier } from "@/lib/data/types";

/** Карточка доната: донор, бейдж тира, сумма, текст (если SHOWN), время. Лента канала и история /me. */
export function DonationCard({
  donation,
  tier,
  displayName,
  showChannel,
  reportable,
  manageChannelId,
}: {
  donation: Donation;
  tier?: Tier;
  displayName?: string;
  showChannel?: boolean;
  reportable?: boolean; // показать «Пожаловаться» (публичная лента показанных сообщений)
  manageChannelId?: string; // задан (зритель управляет каналом) → показать «Забанить» донора
}) {
  const shown = donation.message?.state === "SHOWN";
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-small text-fg">
            {displayName ?? donation.donorName ?? shortAddress(donation.donor)}
          </span>
          {tier ? <TierBadge tier={tier} /> : null}
        </div>
        <Amount micro={donation.amount} />
      </div>
      {shown && donation.message ? (
        <p className="text-body text-fg">{donation.message.text}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-faint">
        <span title={donation.ts}>{timeAgo(donation.ts)}</span>
        {showChannel ? <span className="mono">· {donation.channelId}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {donation.txSignature ? (
            <a
              href={explorerTxUrl(donation.txSignature)}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
              title={donation.txSignature}
            >
              транзакция ↗
            </a>
          ) : null}
          {reportable && shown && donation.message ? (
            <ReportDialog messageId={donation.message.id} channelId={donation.channelId} />
          ) : null}
          {manageChannelId ? (
            <ModerationMenu
              channelId={manageChannelId}
              donor={donation.donor}
              message={donation.message}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
