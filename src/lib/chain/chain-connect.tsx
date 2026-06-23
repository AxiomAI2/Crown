"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LabeledWalletButton } from "./wallet-multi-button";
import { WalletPickerDialog } from "./wallet-picker";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useSession } from "@/lib/data/hooks";

/**
 * Кнопка подключения/входа. Состояния (они разные!):
 *  - не подключён → «Войти» открывает СВОЙ пикер кошельков (wallet-picker): установленный подключается,
 *    отсутствующий ведёт на сайт кошелька, окно остаётся (дефолтную модалку под это перехватить нельзя);
 *  - выбран installed, но ещё не подключён → спиннер «Вход…» (+ выход, если завис);
 *  - подключён без серверной сессии (автоподпись из bridge не прошла) → «Войти (подпись)» повторяет SIWS;
 *  - подключён + сессия → штатная кнопка с дропдауном (копировать адрес / выйти).
 */
export function ChainConnect() {
  const wallet = useWallet();
  const session = useSession();
  const data = useData();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected = wallet.wallet;
  const selectedName = selected?.adapter.name ?? null;
  const installed = selected?.readyState === WalletReadyState.Installed;
  const { select, connected, connecting } = wallet;

  // Самолечение: в localStorage мог остаться выбор кошелька, которого нет (напр. Trust с прошлой попытки).
  // autoConnect к нему заблокирован (гейт installed, см. wallet-provider) → он бы висел «выбранным» без
  // подключения. Тихо забываем такой выбор → вернётся обычная «Войти». Пикер сам не выбирает не-installed.
  useEffect(() => {
    if (selectedName && !installed && !connected && !connecting) select(null);
  }, [selectedName, installed, connected, connecting, select]);

  // Установленный кошелёк подключается пару секунд — спиннер. Если завис дольше, дадим аварийный выход.
  const [showBail, setShowBail] = useState(false);
  const connectingInstalled = !!selected && installed && !connected;
  useEffect(() => {
    if (!connectingInstalled) {
      setShowBail(false);
      return;
    }
    const t = setTimeout(() => setShowBail(true), 6000);
    return () => clearTimeout(t);
  }, [connectingInstalled]);

  if (connectingInstalled) {
    return showBail ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await wallet.disconnect();
          } catch {
            // мог быть и не подключён
          }
          select(null);
        }}
      >
        Отменить вход
      </Button>
    ) : (
      <Button size="sm" loading disabled>
        Вход…
      </Button>
    );
  }

  const connectedNoSession = connected && !session.data?.address;
  if (connectedNoSession) {
    return (
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await data.connect(); // chain: ensureAuth → подпись SIWS текущим кошельком
            await qc.invalidateQueries(); // обновить сессию и все гейты
          } catch (e) {
            toast({
              variant: "error",
              title: "Не удалось войти",
              description: e instanceof Error ? e.message : String(e),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Войти (подпись)
      </Button>
    );
  }

  // Подключён + сессия → штатная кнопка с дропдауном (копировать адрес / сменить / выйти).
  if (connected) return <LabeledWalletButton />;

  // Не подключён → «Войти» открывает свой пикер.
  return (
    <>
      <Button size="sm" onClick={() => setPickerOpen(true)}>
        Войти
      </Button>
      <WalletPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </>
  );
}
