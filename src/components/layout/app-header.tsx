import Link from "next/link";
import { HeaderBalance } from "./header-balance";
import { HeaderSearch } from "./header-search";
import { WalletConnectButton } from "./wallet-connect";

/** Публичная шапка (frontend/spec.md §2). Липкая. Слева — логотип + поиск каналов + nav; справа — кошелёк. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 h-[var(--header-h)] border-b border-border bg-[var(--bg)]">
      <div className="relative mx-auto flex h-full max-w-content items-center gap-4 px-4">
        {/* Логотип = переход на каналы (дискавери). Отдельной ссылки «Каналы» нет. Профиль/Студия — в аватаре. */}
        <Link href="/" className="text-h3 font-display text-fg hover:text-status">
          Standing
        </Link>
        <HeaderSearch />
        <div className="ml-auto flex items-center gap-3">
          <HeaderBalance />
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
