"use client";

import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataProviderProvider } from "@/lib/data/context";
import { createDataProvider } from "@/lib/data/provider";

// Chain-провайдеры — отдельным чанком (грузятся только в режиме chain), чтобы Solana-стек не утяжелял
// bundle mock/api. ssr:false — wallet-adapter трогает window.
const ChainProviders = dynamic(
  () => import("@/lib/chain/chain-providers").then((m) => m.ChainProviders),
  { ssr: false },
);

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

/**
 * Корневые провайдеры. Селектор по ENV: chain → отдельное дерево с кошельком; иначе — оффчейн
 * (TanStack Query + mock/api DataProvider). Компоненты не знают, какая реализация под ними (CLAUDE.md §3).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return IS_CHAIN ? (
    <ChainProviders>{children}</ChainProviders>
  ) : (
    <OffchainProviders>{children}</OffchainProviders>
  );
}

function OffchainProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
            placeholderData: keepPreviousData, // навигация/смена параметров без мигания скелетонов
          },
        },
      }),
  );
  const [provider] = useState(() => createDataProvider(process.env.NEXT_PUBLIC_DATA_SOURCE));

  return (
    <QueryClientProvider client={queryClient}>
      <DataProviderProvider value={provider}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </DataProviderProvider>
    </QueryClientProvider>
  );
}
