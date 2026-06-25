"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useProfile, useSession } from "@/lib/data/hooks";
import { channelHue, shortAddress } from "@/lib/utils";

const itemCls =
  "flex w-full items-center rounded px-3 py-2 text-left text-small text-fg-muted transition-colors hover:bg-surface hover:text-fg";

/**
 * Залогиненное состояние в шапке: аватар-монограмма аккаунта. По наведению (или фокусу — для тача/клавиатуры)
 * выпадает меню: Профиль, Студия, копировать адрес, выйти. Заменяет прежнюю кнопку кошелька. Баланс рядом
 * рисует HeaderBalance отдельно.
 */
export function AccountMenu() {
  const data = useData();
  const session = useSession();
  const address = session.data?.address ?? null;
  const profile = useProfile(address);
  const [copied, setCopied] = useState(false);

  if (!address) return null;
  const display = profile.data?.displayName?.trim();
  const name = display || address;
  const hue = channelHue(name);
  const initial = name.replace(/^@/, "")[0]?.toUpperCase() ?? "?";

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="Аккаунт"
        className="flex h-9 w-9 items-center justify-center rounded-full font-display text-small outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
        style={{ backgroundColor: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 70% 74%)` }}
      >
        {initial}
      </button>

      {/* Меню по наведению/фокусу. pt-2 — невидимый «мостик», чтобы курсор не терял ховер по пути к меню. */}
      <div className="invisible absolute right-0 top-full z-40 pt-2 opacity-0 transition-opacity duration-fast ease-ease group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
          <div className="truncate px-3 pt-2 font-display text-fg">{display || "Аккаунт"}</div>
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <span className="mono truncate text-small text-fg-faint">{shortAddress(address)}</span>
            <button
              type="button"
              title={copied ? "Скопировано" : "Копировать адрес"}
              aria-label="Копировать адрес"
              className="shrink-0 text-fg-faint transition-colors hover:text-fg"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch {
                  toast({ variant: "error", title: "Не удалось скопировать" });
                }
              }}
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="my-1 border-t border-border" />
          <Link href="/me" className={itemCls}>
            Профиль
          </Link>
          <Link href="/studio" className={itemCls}>
            Студия
          </Link>
          <button
            type="button"
            className={`${itemCls} hover:text-danger`}
            onClick={() => {
              void data.disconnect(); // полный выход: revoke токена + дисконект кошелька (мост чистит сессию)
            }}
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
