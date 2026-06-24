import Link from "next/link";
import { HeaderBalance } from "./header-balance";
import { HeaderSearch } from "./header-search";
import { WalletConnectButton } from "./wallet-connect";

/** Публичная шапка (frontend/spec.md §2). Липкая. Слева — логотип + поиск каналов + nav; справа — кошелёк. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 h-[var(--header-h)] border-b border-border bg-surface">
      <div className="mx-auto flex h-full max-w-content items-center gap-4 px-4">
        <Link href="/" className="font-display text-h3 text-fg">
          Standing
        </Link>
        <HeaderSearch />
        {/* Профиль/Студия переехали в меню аватара (AccountMenu) — здесь только дискавери. */}
        <nav className="hidden items-center gap-5 text-small text-fg-muted sm:flex">
          <Link href="/" className="hover:text-fg">
            Каналы
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <HeaderBalance />
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
