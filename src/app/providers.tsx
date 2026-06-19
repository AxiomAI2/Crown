"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { DataProviderProvider } from "@/lib/data/context";
import { createDataProvider } from "@/lib/data/provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";

/**
 * Корневые провайдеры: TanStack Query + выбранный по ENV DataProvider (CLAUDE.md §3).
 * Компоненты никогда не знают, какая реализация (mock/api/chain) стоит под ними.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  const [provider] = useState(() =>
    createDataProvider(process.env.NEXT_PUBLIC_DATA_SOURCE),
  );

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
