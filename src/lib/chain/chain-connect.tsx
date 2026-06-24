"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { AccountMenu } from "./account-menu";
import { WalletPickerDialog } from "./wallet-picker";
import { Button } from "@/components/ui/button";
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

  // Подключён, но сессии ещё нет: подпись SIWS уже запускается АВТОМАТИЧЕСКИ (ChainWalletBridge при
  // подключении). Показываем НЕкликабельный спиннер — раньше тут была кнопка «Войти (подпись)», клик по
  // которой запускал непонятную загрузку, и таких кнопок было несколько (хедер+панель) → можно было
  // нажать все разом. Кликать нечего: подпиши в кошельке. Отказ от подписи отключает кошелёк → «Войти».
  const connectedNoSession = connected && !session.data?.address;
  if (connectedNoSession) {
    return (
      <Button size="sm" loading disabled>
        Вход…
      </Button>
    );
  }

  // Подключён + сессия (залогинен) → аватар аккаунта с меню (профиль/студия/копировать/выйти).
  if (connected) return <AccountMenu />;

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
