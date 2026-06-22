"use client";

import { BaseWalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * Кнопка кошелька wallet-adapter с РУССКИМИ подписями. Главное (по просьбе пользователя): вместо дефолтного
 * «Select Wallet» кнопка зовёт ВОЙТИ, а не «выбрать кошелёк». Ключи labels фиксированы типом
 * BaseWalletMultiButton (состояния кнопки + пункты выпадашки при подключённом кошельке).
 */
const LABELS = {
  "no-wallet": "Войти",
  "has-wallet": "Войти",
  connecting: "Вход…",
  "copy-address": "Копировать адрес",
  copied: "Скопировано",
  "change-wallet": "Сменить кошелёк",
  disconnect: "Выйти",
} as const;

export function LabeledWalletButton() {
  return <BaseWalletMultiButton labels={LABELS} />;
}
