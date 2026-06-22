"use client";

import { ConnectWalletButton } from "./connect-wallet-button";
import { useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

/** Шапка: auth-aware кнопка кошелька/входа (chain) или адрес сессии (dev mock/api). */
export function WalletConnectButton() {
  const { data: session, isLoading } = useSession();

  // Режим chain — auth-aware кнопка: подключает кошелёк, а если сессии нет — предлагает «Войти (подпись)».
  if (IS_CHAIN) return <ConnectWalletButton />;

  // api/mock — dev: вход по адресу идёт через DevToolbar; в шапке просто показываем адрес сессии, если есть.
  if (isLoading) return <div className="h-8 w-32 animate-pulse rounded bg-surface-raised" />;
  return session?.address ? (
    <span className="mono text-small text-fg-muted">{shortAddress(session.address)}</span>
  ) : null;
}
