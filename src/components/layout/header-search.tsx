"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";

/**
 * Поиск каналов в шапке (как search Polymarket): Enter → Discovery с этим запросом (?q=).
 * Десктоп (md+): поле всегда видно. Мобила (<md): чтобы не съедать узкую шапку, показываем иконку-лупу;
 * по тапу она разворачивается в поле поверх всей шапки (фокус сразу, закрытие по Esc / «Отмена»).
 */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false); // мобильный режим: развёрнутое поле поверх шапки
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Каталог живёт на /discovery (ADR 0018), параметр ?q читает только он — не главная.
    router.push(q.trim() ? `/discovery?q=${encodeURIComponent(q.trim())}` : "/discovery");
    setOpen(false);
  }

  // При раскрытии на мобиле — фокус в поле и закрытие по Escape.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const inputCls =
    "h-9 w-full rounded border border-border bg-[var(--bg)] pl-9 pr-3 text-small text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-info";

  return (
    <>
      {/* Десктоп: поле всегда видно. */}
      <form className="relative hidden md:block" onSubmit={submit}>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск каналов…"
          aria-label="Поиск каналов"
          className={`${inputCls} w-56`}
        />
      </form>

      {/* Мобила: иконка-лупа; по тапу — развёрнутое поле поверх шапки. */}
      <button
        type="button"
        aria-label="Поиск каналов"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg md:hidden"
      >
        <SearchIcon className="h-[18px] w-[18px]" />
      </button>
      {open ? (
        <form
          className="absolute inset-0 z-40 flex items-center gap-2 bg-[var(--bg)] px-4 md:hidden"
          onSubmit={submit}
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск каналов…"
              aria-label="Поиск каналов"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-small shrink-0 px-1 text-fg-muted transition-colors hover:text-fg"
          >
            Отмена
          </button>
        </form>
      ) : null}
    </>
  );
}
