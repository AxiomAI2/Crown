"use client";

import { useEffect, useRef, useState } from "react";
import { ReportDialog } from "./report-dialog";
import { MoreIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import {
  useAddBlock,
  useChannelBlocklist,
  useHideDonorMessages,
  useRemoveBlock,
  useSetMessageState,
} from "@/lib/data/hooks";
import type { MessageRef } from "@/lib/data/types";
import { shortAddress } from "@/lib/utils";

const itemCls =
  "flex w-full items-center rounded px-3 py-2 text-left text-small text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";

const closeMenu = (el: HTMLElement) => el.closest("details")?.removeAttribute("open");
const errToast = (e: unknown) => toast({ variant: "error", title: "Ошибка", description: String(e) });

/**
 * Меню действий модерации для владельца/модератора — иконка-щит вместо россыпи кнопок на донате. По клику
 * выпадает выбор: скрыть/показать это сообщение, скрыть ВСЕ сообщения донора, блок/разбан донатов-с-сообщениями.
 * Рендерить только в управляющих местах (лента своего канала, дашборд, очередь) — сервер всё равно авторизует.
 */
export function ModerationMenu({
  channelId,
  donor,
  message,
  allowToggleState = true,
}: {
  channelId: string;
  donor?: string;
  message?: MessageRef;
  allowToggleState?: boolean; // false → не показывать «Показать/Скрыть это сообщение» (есть отдельные кнопки)
}) {
  const setState = useSetMessageState(channelId);
  const hideAll = useHideDonorMessages(channelId);
  const addBlock = useAddBlock(channelId);
  const removeBlock = useRemoveBlock(channelId);
  const blocklist = useChannelBlocklist(channelId);
  const blocked = donor ? (blocklist.data ?? []).some((b) => b.blockedAddress === donor) : false;
  const [reportOpen, setReportOpen] = useState(false);
  // Жаловаться можно на показанный текст или на сообщение в очереди (HELD) — как и на сервере.
  const canReport = !!message && (message.state === "SHOWN" || message.state === "HELD");

  // Нативный <details> сам не закрывается по клику ВНЕ — закрываем вручную (и по Escape).
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = detailsRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.removeAttribute("open");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") detailsRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
    <details ref={detailsRef} className="relative">
      <summary
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden"
        title="Ещё действия"
        aria-label="Действия модерации"
      >
        <MoreIcon className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
        {message && allowToggleState ? (
          <button
            type="button"
            className={itemCls}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              const state = message.state === "SHOWN" ? "HIDDEN" : "SHOWN";
              setState.mutate(
                { messageId: message.id, state },
                {
                  onSuccess: () => toast({ title: state === "HIDDEN" ? "Сообщение скрыто" : "Сообщение показано" }),
                  onError: errToast,
                },
              );
            }}
          >
            {message.state === "SHOWN" ? "Скрыть это сообщение" : "Показать это сообщение"}
          </button>
        ) : null}

        {canReport ? (
          <button
            type="button"
            className={`${itemCls} hover:text-danger`}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              setReportOpen(true);
            }}
          >
            Пожаловаться
          </button>
        ) : null}

        {donor ? (
          <button
            type="button"
            className={itemCls}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              hideAll.mutate(donor, {
                onSuccess: (r) => toast({ title: `Скрыто сообщений: ${r.hidden}` }),
                onError: errToast,
              });
            }}
          >
            Скрыть все сообщения пользователя
          </button>
        ) : null}

        {donor ? (
          blocked ? (
            <button
              type="button"
              className={itemCls}
              onClick={(e) => {
                closeMenu(e.currentTarget);
                removeBlock.mutate(donor, {
                  onSuccess: () => toast({ title: "Разбанен", description: shortAddress(donor) }),
                  onError: errToast,
                });
              }}
            >
              Разбанить донаты-с-сообщениями
            </button>
          ) : (
            <button
              type="button"
              className={`${itemCls} hover:text-danger`}
              onClick={(e) => {
                closeMenu(e.currentTarget);
                addBlock.mutate(
                  { address: donor },
                  {
                    onSuccess: () =>
                      toast({ variant: "success", title: "Заблокированы донаты-с-сообщениями", description: shortAddress(donor) }),
                    onError: errToast,
                  },
                );
              }}
            >
              Блок донатов-с-сообщениями
            </button>
          )
        ) : null}
      </div>
    </details>
    {message ? (
      <ReportDialog
        messageId={message.id}
        channelId={channelId}
        open={reportOpen}
        onOpenChange={setReportOpen}
        trigger={null}
      />
    ) : null}
    </>
  );
}
