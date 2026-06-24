"use client";

import { WalletAdapterNetwork, WalletReadyState, type Adapter, type WalletError } from "@solana/wallet-adapter-base";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { LedgerWalletAdapter } from "@solana/wallet-adapter-ledger";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ChainDataProvider } from "@/lib/data/chain-provider";
import { DEVNET_RPC } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

// WalletConnect (подключает мобильные/прочие кошельки по QR) требует projectId с cloud.reown.com.
// Без него адаптер не добавляем (и не ломаемся). Серверная переменная не нужна — это публичный id.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * Дерево wallet-adapter (devnet). Явные адаптеры (Phantom/Solflare/Coinbase/Trust/Ledger) — чтобы кошельки
 * были в модалке даже если не установлены (со ссылкой на установку). Прочие Standard-кошельки (Backpack,
 * OKX и пр.) подхватятся автоматически. WalletConnect — по QR для мобильных, если задан projectId.
 */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
      new LedgerWalletAdapter(),
      ...(WC_PROJECT_ID
        ? [
            new WalletConnectWalletAdapter({
              network: WalletAdapterNetwork.Devnet,
              options: {
                projectId: WC_PROJECT_ID,
                metadata: {
                  name: "Standing",
                  description: "Локальная репутация за донаты в USDC на Solana",
                  url: typeof window !== "undefined" ? window.location.origin : "https://standing.local",
                  icons: [],
                },
              },
            }),
          ]
        : []),
    ],
    [],
  );
  // wallet-adapter по умолчанию делает console.error на ЛЮБОЙ ошибке кошелька — а Next.js 15 в dev рисует
  // любой console.error огромным красным оверлеем. Отказ пользователя ("User rejected the request") и
  // неготовность кошелька — штатные ситуации, не краш: понижаем до warn. Пользовательский тост про
  // неудавшийся донат/активацию показывают сами мутации (donate.tsx onError), здесь дублировать не нужно.
  const onError = useCallback((error: WalletError) => {
    console.warn("[wallet]", error.name, error.message);
  }, []);
  // autoConnect ТОЛЬКО к реально установленному кошельку. Эта функция консультируется не только при
  // восстановлении выбора на reload, но и при КЛИКЕ по кошельку в модалке. Без гейта выбор кошелька,
  // которого нет (напр. Trust без расширения — readyState Loadable/NotDetected), запускал connect(),
  // который на десктопе уходит в deep-link и НЕ резолвится: UI висит «подключается» без выхода, а
  // autoConnect воспроизводит залипание на каждом reload. Не-installed → не подключаемся; кошелёк
  // останется выбран, и ChainConnect покажет «Отменить вход».
  const onlyInstalled = useCallback(
    (adapter: Adapter) => Promise.resolve(adapter.readyState === WalletReadyState.Installed),
    [],
  );
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect={onlyInstalled} onError={onError}>
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

    // Сменилась личность (вход / выход / смена аккаунта).
    if (addr !== prevAddr.current) {
      // Явный выход (был адрес → стал null): забыть токен (иначе сессия по токену залогинит снова при
      // refresh) и ИНВАЛИДИРОВАТЬ (а НЕ qc.clear!). invalidate перечитывает активные запросы в фоне, но
      // текущие данные остаются на экране до прихода новых → разлогин «морфит» мгновенно, без скелетонов.
      if (prevAddr.current !== null && addr === null) {
        provider.__logout();
        void qc.invalidateQueries();
      }
      // Вход/смена аккаунта (→Y) НЕ инвалидируем здесь: токен ещё не выставлен (ensureAuth ниже), иначе
      // мелькнул бы «разлогинен». ensureAuth выставит токен и сам инвалидирует — старые данные доживут до
      // этого без мигания.
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
