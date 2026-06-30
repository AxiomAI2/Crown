"use client";

import Link from "next/link";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useCopied } from "@/components/ui/use-copied";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useModerationAttention, useProfile, useSession } from "@/lib/data/hooks";
import { channelHue, shortAddress } from "@/lib/utils";

const itemCls =
  "flex w-full items-center rounded px-3 py-2 text-left text-small text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";

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
  const { hasPending } = useModerationAttention();
  const [copied, markCopied] = useCopied(1200);

  if (!address) return null;
  const display = profile.data?.displayName?.trim();
  const name = display || address;
  const hue = channelHue(name);
  const initial = name.replace(/^@/, "")[0]?.toUpperCase() ?? "?";

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={hasPending ? "Аккаунт — есть что проверить" : "Аккаунт"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full font-display text-small outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
        style={{ backgroundColor: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 70% 74%)` }}
      >
        {initial}
        {hasPending ? (
          <NotificationDot
            title="Есть что проверить в студии"
            className="absolute -right-0.5 -top-0.5 ring-2 ring-[var(--bg)]"
          />
        ) : null}
      </button>

      {/* Меню по наведению/фокусу. pt-2 — невидимый «мостик», чтобы курсор не терял ховер по пути к меню. */}
      <div className="invisible absolute right-0 top-full z-40 pt-2 opacity-0 transition-opacity duration-fast ease-ease group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
          <div className="truncate px-3 pt-2 font-display text-fg">{display || "Аккаунт"}</div>
          <button
            type="button"
            title={copied ? "Скопировано" : "Копировать адрес"}
            aria-label="Копировать адрес"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                markCopied();
              } catch {
                toast({ variant: "error", title: "Не удалось скопировать" });
              }
            }}
            className="flex w-full items-center gap-1.5 rounded px-3 py-1.5 text-left text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <span className="mono truncate text-small">{shortAddress(address)}</span>
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
          <div className="my-1 border-t border-border" />
          <Link href="/me" className={itemCls}>
            Профиль
          </Link>
          <Link href="/studio" className={itemCls}>
            Студия
            {hasPending ? (
              <NotificationDot className="ml-2" title="Есть что проверить в очереди" />
            ) : null}
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
