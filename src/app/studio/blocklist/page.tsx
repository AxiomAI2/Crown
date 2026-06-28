"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useAddBlock, useChannelBlocklist, useMyChannel, useRemoveBlock } from "@/lib/data/hooks";
import { shortAddress, timeAgo } from "@/lib/utils";

// Готовые причины канальной блокировки (почему стример закрыл этому кошельку донаты-с-сообщениями).
const BLOCK_REASONS = [
  "Спам / реклама",
  "Оскорбления, травля",
  "Угрозы, агрессия",
  "Мошенничество, скам",
  "Неуместный контент",
  "Другое",
];

export default function BlocklistPage() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const listQ = useChannelBlocklist(channelId);
  const add = useAddBlock(channelId ?? "");
  const remove = useRemoveBlock(channelId ?? "");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");

  if (myChannelQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!channelId) return <EmptyState title="Сначала создай канал" />;

  function submit() {
    if (address.trim().length < 32) {
      toast({ variant: "error", title: "Похоже на неполный адрес" });
      return;
    }
    add.mutate(
      { address: address.trim(), reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Кошелёк заблокирован на канале" });
          setAddress("");
          setReason("");
        },
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Канальные блокировки</h1>
        <p className="text-fg-muted">
          Заблокированные кошельки не шлют донаты-с-текстом на этот канал. Канальный блок ≠ платформенный
          бан (тот — только у оператора).
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="Адрес кошелька" mono value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="flex-1">
          <Select label="Причина" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Без причины</option>
            {BLOCK_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={submit} loading={add.isPending}>
          Заблокировать
        </Button>
      </div>

      {listQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : listQ.error ? (
        <ErrorState onRetry={() => listQ.refetch()} />
      ) : (listQ.data ?? []).length === 0 ? (
        <EmptyState title="Блок-лист пуст" description="Заблокированные кошельки появятся здесь." />
      ) : (
        <ul className="flex flex-col gap-2">
          {listQ.data!.map((b) => (
            <li
              key={b.blockedAddress}
              className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="mono text-small text-fg">{shortAddress(b.blockedAddress)}</span>
                <span className="text-small text-fg-faint">
                  {b.reason ?? "без причины"} · {timeAgo(b.ts)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  remove.mutate(b.blockedAddress, {
                    onSuccess: () => toast({ title: "Разблокировано" }),
                  })
                }
              >
                Разблокировать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
