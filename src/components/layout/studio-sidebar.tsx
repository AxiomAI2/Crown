import Link from "next/link";

const items = [
  { href: "/studio", label: "Обзор" },
  { href: "/studio/create", label: "Создать канал" },
  { href: "/studio/queue", label: "Очередь модерации" },
  { href: "/studio/settings", label: "Настройки канала" },
  { href: "/studio/activation", label: "Активация" },
  { href: "/studio/blocklist", label: "Блок-лист" },
];

/** Сайдбар студии (frontend/spec.md §2). Подсветку активного пункта добавим в Фазе 1. */
export function StudioSidebar() {
  return (
    <aside className="w-56 shrink-0">
      <div className="mb-4 font-display text-h3 text-fg">Студия</div>
      <nav className="flex flex-col gap-1 text-small">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="rounded px-3 py-2 text-fg-muted transition-colors duration-fast ease-ease hover:bg-surface hover:text-fg"
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
