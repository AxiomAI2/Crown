import { Amount } from "./amount";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import type { Channel, ChannelConfig } from "@/lib/data/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="min-w-0 text-small text-fg">{children}</span>
    </div>
  );
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

/** "About" tab: realm details not shown in the hero — payout address, crown minimums, text policy. */
export function ChannelAbout({ channel, config }: { channel: Channel; config?: ChannelConfig }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-5">
      <Row label="Payout">
        <a
          href={explorerAddressUrl(channel.payoutAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono inline-flex items-center gap-1 break-all text-fg-muted transition-colors hover:text-fg"
        >
          {channel.payoutAddress}
          <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
        </a>
      </Row>
      {config ? (
        <>
          <Row label="Min crown">
            <Amount micro={config.minDonation} className="text-fg" />
          </Row>
          <Row label="Min crown + message">
            {channel.status === "ACTIVE" ? (
              <Amount micro={config.minDonationWithText} className="text-fg" />
            ) : (
              <span className="text-fg-faint">Realm not activated yet</span>
            )}
          </Row>
          <Row label="Messages">
            <span className="text-fg-muted">
              {config.textShowMode === "auto_if_clean"
                ? "Auto-shown if clean — else held for the content maker."
                : "Private until the content maker shows them."}
            </span>
          </Row>
        </>
      ) : null}
      <Row label="Opened">
        <span className="text-fg-muted">{fullDate(channel.createdAt)}</span>
      </Row>
    </div>
  );
}
