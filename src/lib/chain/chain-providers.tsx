"use client";

import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChainDataProvider } from "@/lib/data/chain-provider";
import { IcpDataProvider } from "@/lib/data/icp-provider";
import { DataProviderProvider } from "@/lib/data/context";
import { IS_ICP } from "./addresses";
import { ChainWalletBridge, SolanaWalletProvider } from "./wallet-provider";

/**
 * Провайдеры для режимов `chain`/`icp` (Фаза 3 / миграция M1). Грузится динамическим чанком,
 * чтобы тяжёлый Solana-стек не попадал в bundle mock/api. `icp` = тот же chain-провайдер,
 * но канон чтения репутации — core-канистра ICP (IcpDataProvider, ADR 0021).
 */
export function ChainProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // данные «свежие» 30с → возврат на страницу мгновенный из кэша, без рефетча
            gcTime: 10 * 60_000, // держим кэш 10 мин → навигация туда-сюда без перезагрузки
            retry: 1,
            refetchOnWindowFocus: false,
            // при смене ключа (навигация/смена параметра) показываем прошлые данные, пока грузятся новые —
            // без мигания скелетонов. Новые данные подменяют старые, когда придут.
            placeholderData: keepPreviousData,
          },
        },
      }),
  );
  const [provider] = useState(() => (IS_ICP ? new IcpDataProvider() : new ChainDataProvider()));

  return (
    <SolanaWalletProvider>
      <QueryClientProvider client={queryClient}>
        <ChainWalletBridge provider={provider} />
        <DataProviderProvider value={provider}>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </DataProviderProvider>
      </QueryClientProvider>
    </SolanaWalletProvider>
  );
}
