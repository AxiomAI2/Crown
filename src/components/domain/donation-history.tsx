"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Donation } from "@/lib/data/types";

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Поиск по донату: ник (адрес донора), хеш (подпись транзакции), текст сообщения (если доступен — у
 * показанных публично, у всех — для менеджера канала), сумма и id. Регистронезависимая подстрока.
 */
function matches(d: Donation, q: string): boolean {
  if (!q) return true;
  const hay = [
    d.donor,
    d.txSignature ?? "",
    d.message?.text ?? "",
    d.id,
    (Number(d.amount) / 1_000_000).toString(),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Список донатов с поиском и постраничной разбивкой (размер страницы выбирается). Данные — на клиенте.
 * СВОРАЧИВАЕМЫЙ (нативный <details>): по умолчанию свёрнут, заголовок-кнопка показывает счётчик.
 */
export function DonationHistory({
  donations,
  title = "История донатов",
  defaultOpen = false,
  reportable = false,
}: {
  donations: Donation[];
  title?: string;
  defaultOpen?: boolean;
  reportable?: boolean; // показывать «Пожаловаться» на показанных сообщениях (для публичной ленты)
}) {
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => donations.filter((d) => matches(d, q)), [donations, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // фильтр мог укоротить список → не зависаем на пустой стр.
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return (
    <details className="group rounded-lg border border-border bg-surface p-4" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-h3 text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {title} <span className="text-small font-normal text-fg-faint">({donations.length})</span>
        </span>
        <span className="text-small font-normal text-fg-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Поиск"
            placeholder="ник, хеш транзакции, текст, сумма…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          label="На странице"
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          className="sm:w-28"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description={query ? "Измени запрос поиска." : "Пока нет донатов."}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {pageItems.map((d) => (
              <DonationCard key={d.id} donation={d} reportable={reportable} />
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
    </details>
  );
}
