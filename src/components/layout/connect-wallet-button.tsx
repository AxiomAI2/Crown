"use client";

import dynamic from "next/dynamic";

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

// Auth-aware кнопка входа (учитывает и подключение кошелька, и наличие SIWS-сессии). Грузится динамически
// (ssr:false), только в режиме chain → wallet-adapter-стек не попадает в bundle mock/api.
const ChainConnect = dynamic(() => import("@/lib/chain/chain-connect").then((m) => m.ChainConnect), {
  ssr: false,
  loading: () => <div className="h-8 w-40 animate-pulse rounded bg-surface-raised" />,
});

/**
 * Единая кнопка «Войти». В chain — подключает кошелёк и, если нужно, запускает SIWS-подпись (см. ChainConnect).
 * Заменяет прежние ссылки на удалённую страницу /connect. В dev (mock/api) вход — через DevToolbar, тут null.
 */
export function ConnectWalletButton() {
  if (!IS_CHAIN) return null;
  return <ChainConnect />;
}
