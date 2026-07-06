"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { HeaderActions, Monogram } from "./header-actions";
import { useProfile } from "@/lib/data/hooks";
import type { Channel, ChannelConfig } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const HEADER_H = 60; // высота глобальной шапки (--header-h): относительно неё считаем «свёрнуто».

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Подпись + значение в правом числовом кластере hero. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

/**
 * Hero двора — единая панель: слева личность (аватар, имя/@handle, описание, соц-ссылки), справа числовой
 * кластер (Crowned · 👑 The Crown · Since). Мягкий золотой акцент для «дорогого» вида. Баннера нет.
 * При скролле, когда имя уходит под глобальную шапку, всплывает липкая компактная плашка с кнопкой Crown.
 */
export function ChannelHero({
  channel,
  config,
  totalDonated,
  topPatron,
}: {
  channel: Channel;
  config?: ChannelConfig;
  donorsCount?: number;
  totalDonated?: bigint;
  topPatron?: string | null;
}) {
  const ownerProfile = useProfile(channel.ownerAddress);
  const name = ownerProfile.data?.displayName?.trim() || `@${channel.handle}`;
  const avatarUrl = ownerProfile.data?.avatarUrl;
  const links = ownerProfile.data?.links ?? [];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) setCollapsed(!e.isIntersecting);
      },
      { rootMargin: `-${HEADER_H}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Липкая компактная плашка — fixed-оверлей под глобальной шапкой. */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "fixed inset-x-0 top-[var(--header-h)] z-20 transition-all duration-200 ease-ease",
          collapsed ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <div className="px-4 lg:px-6">
          <div className="flex h-[54px] items-center gap-3 border-b border-border bg-[var(--bg)] px-4 shadow-sm">
            <Monogram name={name} avatarUrl={avatarUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate font-display text-fg">{name}</span>
            <a
              href="#crown"
              className="flex items-center gap-1 rounded-md border border-money-dim bg-money-bg/40 px-3 py-1.5 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
            >
              Crown ▸
            </a>
          </div>
        </div>
      </div>

      <header className="relative overflow-hidden p-5 sm:p-6">
        {/* Мягкий золотой акцент (только намёк — дисциплина золота). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-70"
          style={{ background: "radial-gradient(circle, var(--money-bg), transparent 70%)" }}
        />
        {/* Действия — в углу панели. */}
        <div className="absolute right-4 top-4 z-10">
          <HeaderActions payoutAddress={channel.payoutAddress} />
        </div>

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          {/* Личность */}
          <div className="flex min-w-0 items-start gap-4">
            <Monogram name={name} avatarUrl={avatarUrl} size="xl" className="flex-none" />
            <div className="flex min-w-0 flex-col gap-1.5 pr-10 lg:pr-0">
              <div className="flex flex-col gap-0.5">
                <Link
                  href="/"
                  className="w-fit text-caption uppercase tracking-wide text-fg-faint transition-colors hover:text-fg-muted"
                >
                  Realm
                </Link>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 ref={titleRef} className="text-h1 leading-tight text-fg">
                    {name}
                  </h1>
                  <span className="mono text-fg-faint">@{channel.handle}</span>
                </div>
              </div>
              {config?.description?.trim() ? (
                <p className="line-clamp-2 max-w-md whitespace-pre-wrap break-words text-small text-fg-muted">
                  {config.description}
                </p>
              ) : null}
              {links.length > 0 ? <ChannelLinkButtons links={links} variant="pill" /> : null}
            </div>
          </div>

          {/* Числовой кластер — заполняет правую часть панели. */}
          <div className="flex flex-none flex-wrap items-end gap-x-7 gap-y-4 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            {totalDonated !== undefined ? (
              <Fact label="Crowned">
                <Amount
                  micro={totalDonated}
                  variant="money"
                  className="text-[2rem] font-semibold leading-none"
                />
              </Fact>
            ) : null}

            {topPatron ? (
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-10 w-10 flex-none place-items-center rounded-full text-lg"
                  style={{
                    background:
                      "radial-gradient(circle at 40% 30%, var(--money-bright), var(--money) 65%, #b98a2e)",
                    boxShadow: "0 0 16px rgba(228,179,76,0.22)",
                  }}
                  aria-hidden
                >
                  👑
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-caption uppercase tracking-wide text-status">The Crown</span>
                  <span className="truncate text-fg" title={`The Crown: ${topPatron}`}>
                    {topPatron}
                  </span>
                </div>
              </div>
            ) : null}

            <Fact label="Since">
              <span className="text-fg-muted">{monthYear(channel.createdAt)}</span>
            </Fact>
          </div>
        </div>
      </header>
    </>
  );
}
