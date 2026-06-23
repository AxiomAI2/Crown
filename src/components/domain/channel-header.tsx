"use client";

import { useEffect, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import type { Channel, ChannelConfig } from "@/lib/data/types";
import { cn } from "@/lib/utils";

// Высота глобальной шапки (--header-h). Компактная плашка садится прямо под неё, и относительно её же
// определяем «свёрнуто»: заголовок ушёл под шапку → показываем плашку.
const HEADER_H = 60;

/** Стабильный оттенок канала из имени — лёгкая дифференциация каналов (аватарок-картинок нет, §профиль). */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Monogram({ name, size }: { name: string; size: "sm" | "lg" }) {
  const ch = (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
  const hue = hashHue(name);
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

function StatusBadge() {
  return (
    <span className="shrink-0 rounded-pill border border-border px-2 py-0.5 text-small text-fg-faint">
      не активирован
    </span>
  );
}

/**
 * Сворачивающаяся шапка канала (по мотивам polymarket). Вверху — богатая карточка (монограмма, название,
 * @handle, описание, статистика, ссылки). При небольшом скролле, когда заголовок уходит под глобальную
 * шапку, появляется компактная ЛИПКАЯ плашка (монограмма + название) — она fixed-оверлей, поэтому не
 * сдвигает контент. `onCollapse` сообщает странице о смене состояния (правый сайдбар опускается под плашку).
 */
export function ChannelHeader({
  channel,
  config,
  donorsCount,
  totalDonated,
  onCollapse,
}: {
  channel: Channel;
  config?: ChannelConfig;
  donorsCount?: number;
  totalDonated?: bigint;
  onCollapse?: (collapsed: boolean) => void;
}) {
  const name = config?.displayName?.trim() || `@${channel.handle}`;
  const basic = channel.status === "BASIC";
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        const c = !e.isIntersecting;
        setCollapsed(c);
        onCollapse?.(c);
      },
      // верхняя граница наблюдения = низ глобальной шапки: заголовок «исчез» → свернуть.
      { rootMargin: `-${HEADER_H}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onCollapse]);

  return (
    <>
      {/* Компактная плашка — fixed-оверлей под глобальной шапкой; без сдвига контента. */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "fixed inset-x-0 top-[var(--header-h)] z-20 border-b border-border bg-surface transition-all duration-200 ease-ease",
          collapsed ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <div className="mx-auto flex max-w-content items-center gap-3 px-4 py-2">
          <Monogram name={name} size="sm" />
          <span className="truncate font-display text-fg">{name}</span>
          {basic ? <StatusBadge /> : null}
        </div>
      </div>

      {/* Большая шапка-карточка в обычном потоке. */}
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <Monogram name={name} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 ref={titleRef} className="text-display-l text-fg">
                {name}
              </h1>
              {basic ? <StatusBadge /> : null}
            </div>
            {config?.displayName?.trim() ? (
              <span className="mono text-small text-fg-faint">@{channel.handle}</span>
            ) : null}
          </div>
        </div>

        {config?.description?.trim() ? (
          <p className="max-w-2xl text-fg-muted">{config.description}</p>
        ) : null}

        {donorsCount !== undefined ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-fg-muted">
            <span>
              <span className="font-medium text-fg">{donorsCount}</span>{" "}
              {donorsCount === 1 ? "донатер" : "донатеров"}
            </span>
            {totalDonated !== undefined ? (
              <>
                <span className="text-fg-faint">·</span>
                <span className="flex items-center gap-1">
                  всего <Amount micro={totalDonated} variant="money" />
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {config?.links?.length ? <ChannelLinkButtons links={config.links} /> : null}
      </header>
    </>
  );
}
