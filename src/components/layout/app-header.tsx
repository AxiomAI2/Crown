"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWalletButton } from "./connect-wallet-button";
import { CrownWallet } from "./crown-wallet";
import { CrownLogo } from "@/components/crown-logo";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { useSession } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";

/**
 * CROWN header. Sticky. Navigation reads roles from the session (isCreator/isOperator) — no "choose your
 * account type": Studio/Ops appear on their own. Gold across the whole chrome burns just once — on the Connect button (money).
 */
export function AppHeader() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 h-[var(--header-h)] border-b border-border bg-[var(--bg)]">
      <div className="flex h-full w-full items-center gap-6 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="CROWN — home">
          <CrownLogo size={30} className="text-[#c9a24a]" />
          <span className="font-display text-[1.35rem] font-semibold tracking-[0.22em] text-fg">
            CROWN
          </span>
        </Link>

        {/* Navigation — text links only (no action buttons among them). */}
        <nav className="flex items-center gap-1">
          <NavLink href="/games" active={isActive("/games")}>
            Mini-games
          </NavLink>
          {/* Creator funnel: ONE entrance per audience. Guests (not connected) → the "For content makers"
              landing here in the nav; a connected non-creator gets the gold "Create realm" button on the
              right instead (no duplicate nav link). Creators already have a realm — neither shows. */}
          {!session?.address ? (
            <NavLink href="/for-streamers" active={isActive("/for-streamers")}>
              For content makers
            </NavLink>
          ) : null}
          {session?.isOperator && (
            <NavLink href="/ops" active={isActive("/ops")}>
              Ops
            </NavLink>
          )}
          {/* Admin: always visible in dev (metrics without an operator wallet), in production — operator only. */}
          {(process.env.NODE_ENV !== "production" || session?.isOperator) && (
            <NavLink href="/admin" active={isActive("/admin")}>
              Admin
            </NavLink>
          )}
        </nav>

        {/* Account — ONE control on the right. Create realm / Personal Space / Profile / Disconnect all live
            inside the identity dropdown (no separate header buttons). */}
        <div className="ml-auto flex items-center gap-2">
          {/* chain → real wallet + SIWS (ChainConnect); mock/api → dev stub (sign in by address). */}
          {IS_CHAIN ? <ConnectWalletButton /> : <CrownWallet />}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded px-3 py-1.5 text-small transition-colors",
        active ? "text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
