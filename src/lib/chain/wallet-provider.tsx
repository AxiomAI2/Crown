"use client";

import type { WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  // wallet-adapter по умолчанию делает console.error на ЛЮБОЙ ошибке кошелька — а Next.js 15 в dev рисует
  // любой console.error огромным красным оверлеем. Отказ пользователя ("User rejected the request") и
  // неготовность кошелька — штатные ситуации, не краш: понижаем до warn. Пользовательский тост про
  // неудавшийся донат/активацию показывают сами мутации (donate.tsx onError), здесь дублировать не нужно.
  const onError = useCallback((error: WalletError) => {
    console.warn("[wallet]", error.name, error.message);
  }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
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
  const prevAddr = useRef<string | null>(null);
  useEffect(() => {
    provider.setWallet(wallet);
    const addr = wallet?.publicKey?.toBase58() ?? null;
    let cancelled = false;

    // Сменилась личность (вход / выход / смена аккаунта). На ВЫХОДЕ полагаться на ensureAuth нельзя: setWallet
    // выше уже обнулил authedAddress, поэтому ensureAuth вернёт false и инвалидация не сработает — приватные
    // данные прошлой сессии висели бы до естественного рефетча. Детектируем переход здесь и СРАЗУ чистим кэш.
    if (addr !== prevAddr.current) {
      if (prevAddr.current !== null) {
        // явный выход (был адрес → стал null) → забыть токен, иначе сессия по токену залогинит снова при
        // следующем refresh. Смена аккаунта (X→Y) — токен Y перезапишется в ensureAuth ниже.
        if (addr === null) provider.__logout();
        qc.clear(); // не на первом монтировании (чистить нечего, лишний рефетч)
      }
      prevAddr.current = addr;
    }

    // Подключены → проверяем/устанавливаем сессию и перечитываем данные под этой личностью.
    if (addr) {
      provider
        .ensureAuth()
        .then((changed) => {
          if (changed && !cancelled) void qc.invalidateQueries();
        })
        .catch(() => {
          // Пользователь отклонил подпись — остаёмся анонимом. Донатить всё равно можно (вход не нужен).
        });
    }
    return () => {
      cancelled = true;
    };
  }, [provider, wallet, qc]);
  return null;
}
