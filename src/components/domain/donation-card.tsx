import Link from "next/link";
import { Amount } from "./amount";
import { ModerationMenu } from "./moderation-menu";
import { ReportDialog } from "./report-dialog";
import { TierBadge } from "./standing";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { collapseWhitespace, shortAddress, timeAgo } from "@/lib/utils";
import type { Donation, Tier } from "@/lib/data/types";

/** Карточка доната: донор, бейдж тира, сумма, текст (если SHOWN), время. Лента канала и история /me.
 *  variant="card" (по умолчанию) — в рамке; variant="row" — без рамки, с нижним разделителем (лента канала). */
export function DonationCard({
  donation,
  tier,
  displayName,
  showChannel,
  reportable,
  manageChannelId,
  variant = "card",
}: {
  donation: Donation;
  tier?: Tier;
  displayName?: string;
  showChannel?: boolean;
  reportable?: boolean; // показать «Пожаловаться» (публичная лента показанных сообщений)
  manageChannelId?: string; // задан (зритель управляет каналом) → показать «Забанить» донора
  variant?: "card" | "row";
}) {
  const shown = donation.message?.state === "SHOWN";
  return (
    <div
      className={
        variant === "row"
          ? "flex flex-col gap-2 border-b border-border py-4"
          : "flex flex-col gap-2 rounded border border-border bg-surface p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${donation.donor}`}
            className="truncate text-small text-fg transition-colors hover:text-status"
          >
            {displayName ?? donation.donorName ?? shortAddress(donation.donor)}
          </Link>
          {tier ? <TierBadge tier={tier} /> : null}
        </div>
        <Amount micro={donation.amount} />
      </div>
      {shown && donation.message ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(donation.message.text)}</p>
      ) : donation.message ? (
        // Сообщение есть, но не показано (HELD/HIDDEN) — помечаем явно, а не пустой строкой.
        <p className="text-body italic text-fg-faint">[не показано]</p>
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
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="Транзакция в проводнике"
              aria-label="Транзакция в проводнике"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          {reportable && shown && donation.message && !manageChannelId ? (
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
