"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useModerationAttention, useMyChannel } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";

const MANAGE_ITEMS = [
  { href: "/studio", label: "Обзор" },
  { href: "/studio/queue", label: "Очередь модерации" },
  { href: "/studio/games", label: "Настройки мини-игр" },
  { href: "/studio/settings", label: "Настройки канала" },
  { href: "/studio/blocklist", label: "Блок-лист" },
];

/**
 * Сайдбар студии (десктоп — фиксирован, rail-pinned-left). Без канала показываем только «Обзор» (там форма
 * создания). Создание/активация — НЕ отдельные пункты: создание инлайн в обзоре, активация — контекстным
 * баннером во всех вкладках (ChannelStatusBanner), чтобы пункты не висели после выполнения шага.
 */
export function StudioSidebar() {
  const pathname = usePathname();
  const { data: channel } = useMyChannel();
  const { hasPending } = useModerationAttention();
  const items = channel ? MANAGE_ITEMS : [{ href: "/studio", label: "Обзор" }];
  return (
    <aside className="rail-pinned-left w-full shrink-0">
      {/* Заголовок секции — только на десктопе; на мобиле его роль играет H1 самой страницы (экономим высоту). */}
      <div className="text-h3 mb-4 hidden font-display text-fg md:block">Студия</div>
      {/* Мобила: горизонтальный таб-бар с прокруткой (не выталкивает контент вниз длинным вертикальным списком).
          Десктоп (md+): обычная вертикальная навигация. Поля -mx-4/px-4 дают прокрутке упираться в края экрана. */}
      <nav className="text-small -mx-4 flex flex-row gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const active = pathname === it.href;
          const attention = it.href === "/studio/queue" && hasPending; // новые донаты-с-текстом ждут решения
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded px-3 py-2 transition-colors duration-fast ease-ease",
                active
                  ? "bg-surface-raised text-fg"
                  : "text-fg-muted hover:bg-surface-raised hover:text-fg",
              )}
            >
              {it.label}
              {attention ? <NotificationDot title="Есть что проверить в очереди" /> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
