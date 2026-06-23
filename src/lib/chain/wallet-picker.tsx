"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Один кошелёк из wallet-adapter (адаптер + его readyState). Выводим тип из useWallet, чтобы не гадать,
// из какого пакета реэкспортируется Wallet.
type WalletEntry = ReturnType<typeof useWallet>["wallets"][number];

/**
 * Своя модалка выбора кошелька (дефолтная из wallet-adapter-react-ui по клику всегда делает select+закрыть,
 * без различия installed/нет — перехватить нельзя). Поведение по требованию:
 *  - установленный кошелёк → select() (autoConnect подключит) + закрыть окно;
 *  - кошелёк, которого НЕТ → НЕ подключаемся и НЕ закрываем окно, а сразу открываем сайт кошелька в новой
 *    вкладке (там его можно установить). Так пользователь не залипает в «подключается» и видит список дальше.
 */
export function WalletPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { wallets, select } = useWallet();
  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed);
  const others = wallets.filter((w) => w.readyState !== WalletReadyState.Installed);

  function pick(w: WalletEntry) {
    if (w.readyState === WalletReadyState.Installed) {
      select(w.adapter.name); // autoConnect (гейт installed) подключит
      onOpenChange(false);
      return;
    }
    // Кошелька нет — не трогаем выбор/подключение, окно оставляем открытым, ведём ставить его.
    window.open(w.adapter.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить кошелёк</DialogTitle>
          <DialogDescription>
            Установленные подключатся сразу. У остальных откроется сайт, где их можно поставить, — окно
            останется здесь.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {installed.map((w) => (
            <WalletRow key={w.adapter.name} wallet={w} onClick={() => pick(w)} />
          ))}
          {installed.length > 0 && others.length > 0 ? (
            <div className="mt-2 text-small text-fg-faint">Нет установленного? Поставьте один из:</div>
          ) : null}
          {others.map((w) => (
            <WalletRow key={w.adapter.name} wallet={w} onClick={() => pick(w)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WalletRow({ wallet, onClick }: { wallet: WalletEntry; onClick: () => void }) {
  const installed = wallet.readyState === WalletReadyState.Installed;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-fg-faint hover:bg-surface-raised"
    >
      {wallet.adapter.icon ? (
        // Иконка кошелька — data-URI из адаптера; next/image тут лишний.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wallet.adapter.icon} alt="" className="h-6 w-6 shrink-0" />
      ) : (
        <span className="h-6 w-6 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-display text-fg">{wallet.adapter.name}</span>
      <span className="shrink-0 text-small text-fg-faint">
        {installed ? "Обнаружен" : "Установить ↗"}
      </span>
    </button>
  );
}
