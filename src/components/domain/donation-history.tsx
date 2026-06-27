"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
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
    d.donor, // адрес донора
    d.donorName ?? "", // ник (отображаемое имя)
    d.txSignature ?? "", // хеш транзакции
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
  manageChannelId,
  collapsible = true,
  plain = false,
}: {
  donations: Donation[];
  title?: string;
  defaultOpen?: boolean;
  reportable?: boolean; // показывать «Пожаловаться» на показанных сообщениях (для публичной ленты)
  manageChannelId?: string; // задан → у каждого доната кнопка «Забанить» (владелец/модератор канала)
  collapsible?: boolean; // false → без сворачивания (напр. в табах канала — там это уже лишнее), всегда раскрыт
  plain?: boolean; // «воздушная» лента: без поиска/пагинации/рамки, заголовок-секция, строки с разделителями
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

  const count = <span className="text-small font-normal text-fg-faint">({donations.length})</span>;

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Поиск"
            icon={<SearchIcon className="h-4 w-4" />}
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
              <DonationCard
                key={d.id}
                donation={d}
                reportable={reportable}
                manageChannelId={manageChannelId}
              />
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
                <ChevronLeftIcon className="h-4 w-4" />
                Назад
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
                Вперёд
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // «Воздушная» лента (страница канала): заголовок-секция + строки с разделителями, без поиска/пагинации/рамки.
  if (plain) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-caption uppercase tracking-wide text-fg-faint">
          {title} · {donations.length}
        </div>
        {donations.length === 0 ? (
          <p className="py-6 text-center text-small text-fg-faint">Пока нет показанных сообщений.</p>
        ) : (
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {donations.map((d) => (
              <DonationCard
                key={d.id}
                donation={d}
                variant="row"
                reportable={reportable}
                manageChannelId={manageChannelId}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Несворачиваемо (напр. в табах канала) — обычная карточка с заголовком, контент всегда виден.
  if (!collapsible) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-h3 text-fg">{title} {count}</h3>
        {body}
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-border bg-surface p-4" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-h3 text-fg [&::-webkit-details-marker]:hidden">
        <span>{title} {count}</span>
        <span className="text-small font-normal text-fg-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-4">{body}</div>
    </details>
  );
}
