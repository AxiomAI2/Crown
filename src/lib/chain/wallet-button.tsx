"use client";

import dynamic from "next/dynamic";

/**
 * Кнопка подключения реального кошелька (wallet-adapter) с РУССКИМИ подписями («Войти» вместо дефолтного
 * «Select Wallet», см. wallet-multi-button.tsx). Грузится динамически (ssr:false), доступна только внутри
 * SolanaWalletProvider (режим chain). В bundle mock/api не попадает.
 */
export const WalletButton = dynamic(
  () => import("./wallet-multi-button").then((m) => m.LabeledWalletButton),
  { ssr: false, loading: () => <div className="h-8 w-40 animate-pulse rounded bg-surface-raised" /> },
);
