"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TaskFeedRow } from "@/games/escrow-task/EscrowTaskPanel";
import type { EscrowTask } from "@/games/escrow-task/types";
import { useSession } from "@/lib/data/hooks";
import type { Donation } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100];

type FeedItem =
  | { kind: "donation"; key: string; ts: number; hay: string; d: Donation }
  | { kind: "task"; key: string; ts: number; hay: string; t: EscrowTask };

const donationHay = (d: Donation): string =>
  [d.donor, d.donorName ?? "", d.txSignature ?? "", d.message?.text ?? "", d.id, String(fromMicro(d.amount))]
    .join(" ")
    .toLowerCase();

const taskHay = (t: EscrowTask): string =>
  [t.donor, t.text, t.fundTx ?? "", t.id, String(fromMicro(BigInt(t.amount))), t.status, t.resolution?.outcome ?? ""]
    .join(" ")
    .toLowerCase();

/**
 * Единая лента канала (заменяет разделённые «Лента»/«Донаты»): обычные донаты + донаты-с-заданиями (игры) в
 * ОДНОМ таймлайне по времени — ник, сумма, текст, результат. Задания показываются read-only (метка «Задание» +
 * статус/исход); управление ими — во вкладке «Игры». Поиск (ник/хеш/текст/сумма) + пагинация, как в истории.
 */
export function ChannelFeed({
  donations,
  tasks,
  handle,
  reportable = false,
  manageChannelId,
}: {
  donations: Donation[];
  tasks: EscrowTask[];
  handle: string; // для ссылки на детали спора задания (/c/<handle>/dispute/<taskId>)
  reportable?: boolean; // «Пожаловаться» на показанных сообщениях (бывшая «Лента»)
  manageChannelId?: string; // задан → «Забанить» донора (владелец/модератор)
}) {
  const viewer = useSession().data?.address ?? null; // для «Пожаловаться» на заданиях
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const items = useMemo<FeedItem[]>(() => {
    const ds = donations.map<FeedItem>((d) => ({
      kind: "donation",
      key: `d:${d.id}`,
      ts: Date.parse(d.ts),
      hay: donationHay(d),
      d,
    }));
    const ts = tasks
      .filter((t) => !t.hidden) // отклонённые стримером не показываем в ленте (вернутся донору по таймеру)
      .map<FeedItem>((t) => ({
        kind: "task",
        key: `t:${t.id}`,
        ts: Date.parse(t.createdAt),
        hay: taskHay(t),
        t,
      }));
    return [...ds, ...ts].sort((a, b) => b.ts - a.ts); // новее сверху
  }, [donations, tasks]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? items.filter((it) => it.hay.includes(q)) : items), [items, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // фильтр мог укоротить список → не зависаем на пустой стр.
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-caption uppercase tracking-wide text-fg-faint">Донаты · {items.length}</span>

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
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {pageItems.map((it) =>
              it.kind === "donation" ? (
                <DonationCard
                  key={it.key}
                  donation={it.d}
                  variant="row"
                  reportable={reportable}
                  manageChannelId={manageChannelId}
                />
              ) : (
                <TaskFeedRow
                  key={it.key}
                  task={it.t}
                  handle={handle}
                  viewer={viewer}
                  manageChannelId={manageChannelId}
                />
              ),
            )}
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
}
