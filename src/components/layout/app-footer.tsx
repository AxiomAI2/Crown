import { EXPLORER_CLUSTER } from "@/lib/chain/addresses";

/** Минимальный глобальный футер (frontend/spec.md §2). Статичный — без данных/клиента. */
export function AppFooter() {
  return (
    <footer className="border-t border-border bg-[var(--bg)]">
      <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-1 px-4 py-6 text-small text-fg-faint sm:flex-row">
        <span>Standing — локальная репутация за донаты в USDC на Solana</span>
        <span className="mono">{EXPLORER_CLUSTER} · некастодиально</span>
      </div>
    </footer>
  );
}
