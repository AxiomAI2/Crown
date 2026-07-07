"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CrownLogo } from "@/components/crown-logo";
import { cn } from "@/lib/utils";

const GROUP_MAIN = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/realms", label: "Realms" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/games", label: "Mini-games" },
];
const GROUP_OPS = [
  { href: "/admin/tests", label: "Tests" },
  { href: "/admin/moderation", label: "Moderation" },
];
const GROUP_SETTINGS = [{ href: "/admin/settings", label: "Settings" }];

/**
 * Full-height admin sidebar (as in the reference): logo on top, vertical border on the right (top-to-bottom).
 * Desktop — a sticky full-screen column; mobile — a top block (logo + horizontal tab bar).
 */
export function AdminSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "flex w-full flex-col border-b border-border bg-[var(--bg)] transition-[width] duration-slow ease-ease md:sticky md:top-0 md:h-[100dvh] md:flex-none md:overflow-hidden md:border-b-0 md:border-r",
        collapsed ? "md:w-14" : "md:w-56",
      )}
    >
      {/* Logo on top — stays visible even when collapsed (when collapsed — just the mark). */}
      <Link
        href="/"
        aria-label="CROWN — home"
        className={cn(
          "flex h-[var(--header-h)] flex-none items-center gap-2.5 px-4",
          collapsed && "md:justify-center md:px-0",
        )}
      >
        <CrownLogo size={26} className="text-[#c9a24a]" />
        <span
          className={cn(
            "font-display text-lg font-semibold tracking-[0.2em] text-fg",
            collapsed && "md:hidden",
          )}
        >
          CROWN
        </span>
      </Link>

      {/* Navigation — hidden when collapsed */}
      <nav
        className={cn(
          "text-small flex flex-row gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:flex-col md:overflow-visible md:pb-0 md:pt-2 [&::-webkit-scrollbar]:hidden",
          collapsed && "md:hidden",
        )}
      >
        {GROUP_MAIN.map((it) => (
          <NavItem key={it.href} {...it} active={isActive(it.href)} />
        ))}
        <div className="my-2 hidden h-px bg-border md:block" />
        {GROUP_OPS.map((it) => (
          <NavItem key={it.href} {...it} active={isActive(it.href)} />
        ))}
        <div className="my-2 hidden h-px bg-border md:block" />
        {GROUP_SETTINGS.map((it) => (
          <NavItem key={it.href} {...it} active={isActive(it.href)} />
        ))}
      </nav>
    </aside>
  );
}

function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md px-3 py-2 transition-colors duration-fast ease-ease",
        active
          ? "bg-surface-raised font-medium text-money"
          : "text-fg-muted hover:bg-surface-raised hover:text-fg",
      )}
    >
      {label}
    </Link>
  );
}
