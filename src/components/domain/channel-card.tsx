import Link from "next/link";
import { Amount } from "./amount";
import { PlatformIcon } from "./channel-links";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import { platformDef } from "@/lib/channel-links";
import type { ChannelCard } from "@/lib/data/types";
import { channelHue, shortAddress } from "@/lib/utils";

function pluralDonors(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "донатер";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "донатера";
  return "донатеров";
}

/** Карточка канала в Discovery: монограмма, название/@handle, тир, описание, инфо о донатерах, мини-ссылки
 *  на соцсети и payout-адрес. Тело — ссылка на канал; соцсети/кошелёк — отдельные ссылки (не вложены). */
export function ChannelCardTile({ card }: { card: ChannelCard }) {
  const named = Boolean(card.displayName?.trim());
  const name = card.displayName?.trim() || `@${card.handle}`;
  const hue = channelHue(name);
  const links = card.links ?? [];
  const MAX_LINKS = 4; // дальше — троеточие на страницу канала (там все ссылки)
  const shownLinks = links.slice(0, MAX_LINKS);
  const hiddenLinks = links.length - shownLinks.length;

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-fast ease-ease hover:border-border-strong">
      {/* Кликабельное тело → страница канала */}
      <Link href={`/c/${card.handle}`} className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-h3"
            style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
          >
            {name.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-fg transition-colors group-hover:text-status">
              {name}
            </div>
            {named ? (
              <div className="mono truncate text-small text-fg-faint">@{card.handle}</div>
            ) : null}
          </div>
          <span className="shrink-0 rounded-pill bg-status-bg px-2 py-0.5 text-small text-status">
            {card.topTierName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-fg-muted">
          <span>
            <span className="font-medium text-fg">{card.donorsCount}</span>{" "}
            {pluralDonors(card.donorsCount)}
          </span>
          <span className="flex items-center gap-1">
            объём <Amount micro={card.totalDonated} variant="money" />
          </span>
        </div>
      </Link>

      {/* Футер: мини-ссылки на соцсети + payout-адрес в проводник (отдельные ссылки). */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex min-w-0 items-center gap-1">
          {links.length > 0 ? (
            <>
              {shownLinks.map((l) => (
                <a
                  key={l.platform}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={platformDef(l.platform)?.label ?? l.platform}
                  aria-label={platformDef(l.platform)?.label ?? l.platform}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                >
                  <PlatformIcon platform={l.platform} brand className="h-4 w-4" />
                </a>
              ))}
              {hiddenLinks > 0 ? (
                <Link
                  href={`/c/${card.handle}`}
                  title={`Ещё ${hiddenLinks} — на странице канала`}
                  aria-label={`Ещё ${hiddenLinks} ссылок на странице канала`}
                  className="flex h-7 items-center justify-center rounded-md px-2 text-small leading-none text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
                >
                  …
                </Link>
              ) : null}
            </>
          ) : (
            <span className="text-small text-fg-faint">нет ссылок</span>
          )}
        </div>
        <a
          href={explorerAddressUrl(card.payoutAddress)}
          target="_blank"
          rel="noopener noreferrer"
          title="Payout-адрес в Solana Explorer"
          className="mono flex shrink-0 items-center gap-1 text-small text-fg-faint transition-colors hover:text-fg"
        >
          {shortAddress(card.payoutAddress)} ↗
        </a>
      </div>
    </div>
  );
}
