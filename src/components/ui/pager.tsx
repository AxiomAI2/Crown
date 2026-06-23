"use client";

import { useState } from "react";
import { Button } from "./button";
import { Select } from "./select";

const SIZES = [10, 25, 50];

/** Локальная постраничная разбивка списка (клиент). Возвращает срез текущей страницы + контролы состояния. */
export function usePager<T>(items: T[], defaultSize = 10) {
  const [pageSize, setPageSize] = useState(defaultSize);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // фильтр/убыль списка → не зависаем на пустой странице
  const start = safePage * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    total: items.length,
  };
}

/** Контролы пагинации: размер страницы + назад/вперёд + счётчик. Скрыты, если элементов мало. */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  setPage,
  setPageSize,
  sizes = SIZES,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
  sizes?: number[];
}) {
  if (total <= sizes[0]!) return null; // мало элементов — пагинация не нужна
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-small text-fg-faint">
      <span>Всего: {total}</span>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          className="w-20"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
          ← Назад
        </Button>
        <span className="mono">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => setPage(page + 1)}
        >
          Вперёд →
        </Button>
      </div>
    </div>
  );
}
