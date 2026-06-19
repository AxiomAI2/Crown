"use client";

import { createContext, useContext } from "react";
import type { DataProvider } from "./provider";

const Ctx = createContext<DataProvider | null>(null);

export function DataProviderProvider({
  value,
  children,
}: {
  value: DataProvider;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Единственный способ для компонентов добраться до данных (CLAUDE.md §3). */
export function useData(): DataProvider {
  const provider = useContext(Ctx);
  if (!provider) {
    throw new Error("useData() должен использоваться внутри <Providers>");
  }
  return provider;
}
