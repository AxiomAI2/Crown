import Link from "next/link";
import { WalletConnectButton } from "./wallet-connect";

/** Публичная шапка (frontend/spec.md §2). */
export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-display text-h3 text-fg">
          Standing
        </Link>
        <nav className="hidden items-center gap-5 text-small text-fg-muted sm:flex">
          <Link href="/" className="hover:text-fg">
            Каналы
          </Link>
          <Link href="/me" className="hover:text-fg">
            Моё standing
          </Link>
          <Link href="/studio" className="hover:text-fg">
            Студия
          </Link>
        </nav>
        <WalletConnectButton />
      </div>
    </header>
  );
}
