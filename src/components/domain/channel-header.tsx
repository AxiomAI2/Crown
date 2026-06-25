"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import { useProfile } from "@/lib/data/hooks";
import type { Channel, ChannelConfig } from "@/lib/data/types";
import { channelHue, cn } from "@/lib/utils";

// Высота глобальной шапки (--header-h). Компактная плашка садится прямо под неё, и относительно её же
// определяем «свёрнуто»: заголовок ушёл под шапку → показываем плашку.
const HEADER_H = 60;

function Monogram({ name, size }: { name: string; size: "sm" | "lg" }) {
  const ch = (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
  const hue = channelHue(name);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display",
        size === "lg" ? "h-14 w-14 text-h3" : "h-7 w-7 text-small",
      )}
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
    >
      {ch}
    </div>
  );
}


// — Иконки-действия (stroke, currentColor). Те же в hero и в компактной плашке (как на polymarket). —
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ShareIcon({ done }: { done: boolean }) {
  return (
    <svg {...iconProps} className="h-[18px] w-[18px]">
      {done ? (
        <path d="M20 6 9 17l-5-5" />
      ) : (
        <>
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
        </>
      )}
    </svg>
  );
}

function ExplorerIcon() {
  return (
    <svg {...iconProps} className="h-[18px] w-[18px]">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

const actionBtn =
  "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg";

/** Ряд иконок-действий: поделиться (ссылка) + скопировать адрес канала + открыть payout в Solana Explorer. */
function HeaderActions({ payoutAddress }: { payoutAddress: string }) {
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className={actionBtn}
        title="Поделиться (скопировать ссылку)"
        aria-label="Поделиться"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast({ variant: "success", title: "Ссылка скопирована" });
          } catch {
            toast({ variant: "error", title: "Не удалось скопировать" });
          }
        }}
      >
        <ShareIcon done={copied} />
      </button>
      <button
        type="button"
        className={actionBtn}
        title="Скопировать адрес канала"
        aria-label="Скопировать адрес канала"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(payoutAddress);
            setAddrCopied(true);
            setTimeout(() => setAddrCopied(false), 1500);
            toast({ variant: "success", title: "Адрес канала скопирован" });
          } catch {
            toast({ variant: "error", title: "Не удалось скопировать" });
          }
        }}
      >
        {addrCopied ? <CheckIcon className="h-[18px] w-[18px]" /> : <CopyIcon className="h-[18px] w-[18px]" />}
      </button>
      <a
        className={actionBtn}
        href={explorerAddressUrl(payoutAddress)}
        target="_blank"
        rel="noopener noreferrer"
        title="Payout-адрес в Solana Explorer"
        aria-label="Открыть в проводнике"
      >
        <ExplorerIcon />
      </a>
    </div>
  );
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

/**
 * Сворачивающаяся шапка канала (по мотивам polymarket). Вверху — hero: монограмма, хлебные крошки, крупный
 * тайтл, иконки-действия справа, мета-строка (донатеры · сумма · с даты), затем описание и ссылки. При
 * небольшом скролле, когда тайтл уходит под глобальную шапку, появляется компактная ЛИПКАЯ плашка
 * (монограмма + тайтл + те же действия) — fixed-оверлей шириной левой колонки, без сдвига контента.
 */
export function ChannelHeader({
  channel,
  config,
  donorsCount,
  totalDonated,
}: {
  channel: Channel;
  config?: ChannelConfig;
  donorsCount?: number;
  totalDonated?: bigint;
}) {
  // Имя и ссылки канала = профиль ВЛАДЕЛЬЦА (единый ник/ссылки на человека). Описание — канальное (config).
  const ownerProfile = useProfile(channel.ownerAddress);
  const name = ownerProfile.data?.displayName?.trim() || `@${channel.handle}`;
  const links = ownerProfile.data?.links ?? [];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        setCollapsed(!e.isIntersecting);
      },
      // верхняя граница наблюдения = низ глобальной шапки: тайтл «исчез» → свернуть.
      { rootMargin: `-${HEADER_H}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Компактная плашка — fixed-оверлей под глобальной шапкой; ширина = левая колонка (резерв рейла
          360px + gap-6=32px справа), без сдвига контента. fade + лёгкий slide сверху. */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "fixed inset-x-0 top-[var(--header-h)] z-20 transition-all duration-200 ease-ease",
          collapsed ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <div className="mx-auto max-w-content px-4 lg:pr-[calc(360px+2rem+1rem)]">
          <div className="flex h-[54px] items-center gap-3 border-b border-border bg-surface px-4 shadow-sm">
            <Monogram name={name} size="sm" />
            <span className="min-w-0 flex-1 truncate font-display text-fg">{name}</span>
            <HeaderActions payoutAddress={channel.payoutAddress} />
          </div>
        </div>
      </div>

      {/* Hero-блок в обычном потоке. */}
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <Monogram name={name} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* хлебные крошки */}
            <Link href="/" className="w-fit text-small text-fg-faint hover:text-fg-muted">
              Каналы
            </Link>
            <h1 ref={titleRef} className="text-display-l text-fg">
              {name}
            </h1>
            {/* мета-строка под тайтлом */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-muted">
              {ownerProfile.data?.displayName?.trim() ? (
                <>
                  <span className="mono text-fg-faint">@{channel.handle}</span>
                  <span className="text-fg-faint">·</span>
                </>
              ) : null}
              {donorsCount !== undefined ? (
                <>
                  <Link href={`/c/${channel.handle}/donors`} className="hover:text-fg">
                    <span className="font-medium text-fg">{donorsCount}</span>{" "}
                    {donorsCount === 1 ? "донатер" : "донатеров"}
                  </Link>
                  {totalDonated !== undefined ? (
                    <>
                      <span className="text-fg-faint">·</span>
                      <span className="flex items-center gap-1">
                        всего <Amount micro={totalDonated} variant="money" />
                      </span>
                    </>
                  ) : null}
                  <span className="text-fg-faint">·</span>
                </>
              ) : null}
              <span>с {formatMonthYear(channel.createdAt)}</span>
            </div>
          </div>
          {/* иконки-действия справа */}
          <HeaderActions payoutAddress={channel.payoutAddress} />
        </div>

        {config?.description?.trim() ? (
          <p className="max-w-2xl text-fg-muted">{config.description}</p>
        ) : null}

        {links.length > 0 ? <ChannelLinkButtons links={links} /> : null}
      </header>
    </>
  );
}
