"use client";

import { useMemo, useState } from "react";
import { ChannelCardTile } from "./channel-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import type { ChannelCard } from "@/lib/data/types";

const PAGE_SIZES = [6, 12, 24, 48];

/** Поиск по каналу: хэндл, отображаемое имя, верхний тир. Регистронезависимая подстрока. */
function matches(c: ChannelCard, q: string): boolean {
  if (!q) return true;
  return [c.handle, c.displayName ?? "", c.topTierName].join(" ").toLowerCase().includes(q);
}

/** Сетка карточек каналов с поиском и постраничной разбивкой. Сами карточки остаются прежними. */
export function ChannelBrowser({
  channels,
  initialQuery = "",
}: {
  channels: ChannelCard[];
  initialQuery?: string;
}) {
  const [pageSize, setPageSize] = useState(12);
  const [page, setPage] = useState(0);

  // Запрос приходит из поиска в ШАПКЕ (?q) — отдельного поля на странице каналов нет.
  const q = initialQuery.trim().toLowerCase();
  const filtered = useMemo(() => channels.filter((c) => matches(c, q)), [channels, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return (
    <div className="flex flex-col gap-4">
      {filtered.length > PAGE_SIZES[0]! ? (
        <div className="flex justify-end">
          <Select
            label="На странице"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="w-28"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description={q ? "Под запрос из поиска ничего нет." : "Пока нет каналов."}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((c) => (
              <ChannelCardTile key={c.channelId} card={c} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
            <span>Всего: {filtered.length}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage <= 0}
                onClick={() => setPage(safePage - 1)}
              >
                ← Назад
              </Button>
              <span className="mono">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Вперёд →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
