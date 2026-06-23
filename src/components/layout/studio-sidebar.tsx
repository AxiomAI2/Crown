"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/studio", label: "Обзор" },
  { href: "/studio/create", label: "Создать канал" },
  { href: "/studio/queue", label: "Очередь модерации" },
  { href: "/studio/settings", label: "Настройки канала" },
  { href: "/studio/activation", label: "Активация" },
  { href: "/studio/blocklist", label: "Блок-лист" },
];

/** Сайдбар студии: прибит на месте при скролле (sticky под хедером) + подсветка активного пункта. */
export function StudioSidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-full shrink-0 md:sticky md:top-20 md:w-56 md:self-start">
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
