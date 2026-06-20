"use client";

import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ChainDataProvider } from "@/lib/data/chain-provider";
import { DEVNET_RPC } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Дерево wallet-adapter (devnet). Явные адаптеры Phantom/Solflare (из отдельных пакетов, без тяжёлого
 * WalletConnect-стека), чтобы кошельки всегда были в модалке — даже если не установлены (со ссылкой на
 * установку). Standard-кошельки (Backpack и пр.) подхватятся автоматически.
 */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * Инжектит состояние кошелька (useWallet) в ChainDataProvider — класс не вызывает хуки. После подключения
 * запускает SIWS-вход (серверный nonce + проверка подписи); при смене авторизации инвалидирует кэш, чтобы
 * session/myChannel перечитались под новой личностью. Должен жить ВНУТРИ QueryClientProvider.
 */
export function ChainWalletBridge({ provider }: { provider: ChainDataProvider }) {
  const wallet = useWallet();
  const qc = useQueryClient();
  useEffect(() => {
    provider.setWallet(wallet);
    let cancelled = false;
    provider
      .ensureAuth()
      .then((changed) => {
        if (changed && !cancelled) void qc.invalidateQueries();
      })
      .catch(() => {
        // Пользователь отклонил подпись — остаёмся анонимом. Донатить всё равно можно (вход не нужен).
      });
    return () => {
      cancelled = true;
    };
  }, [provider, wallet, qc]);
  return null;
}
