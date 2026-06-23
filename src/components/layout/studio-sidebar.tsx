"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePinAboveFooter } from "@/lib/use-pin-above-footer";
import { cn } from "@/lib/utils";

const items = [
  { href: "/studio", label: "Обзор" },
  { href: "/studio/create", label: "Создать канал" },
  { href: "/studio/queue", label: "Очередь модерации" },
  { href: "/studio/settings", label: "Настройки канала" },
  { href: "/studio/activation", label: "Активация" },
  { href: "/studio/blocklist", label: "Блок-лист" },
];

/**
 * Сайдбар студии: на десктопе ФИКСИРОВАН на экране (rail-pinned-left) — не двигается ВООБЩЕ при скролле.
 * Его трек в гриде студии остаётся зарезервированным, поэтому контент не плывёт. На мобиле — обычным блоком.
 */
export function StudioSidebar() {
  const pathname = usePathname();
  const ref = usePinAboveFooter<HTMLElement>();
  return (
    <aside ref={ref} className="w-full shrink-0 rail-pinned-left">
      <div className="mb-4 font-display text-h3 text-fg">Студия</div>
      <nav className="flex flex-col gap-1 text-small">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded px-3 py-2 transition-colors duration-fast ease-ease",
                active ? "bg-surface text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
              )}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
