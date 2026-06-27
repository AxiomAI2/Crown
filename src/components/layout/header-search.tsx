"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchIcon } from "@/components/ui/icons";

/** Поиск каналов в шапке (как search Polymarket): Enter → Discovery с этим запросом (?q=). */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative hidden md:block"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
      }}
    >
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск каналов…"
        aria-label="Поиск каналов"
        className="h-9 w-56 rounded border border-border bg-[var(--bg)] pl-9 pr-3 text-small text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
      />
    </form>
  );
}
