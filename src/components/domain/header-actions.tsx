"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import { channelHue, cn } from "@/lib/utils";

// Размеры монограммы (аватар-заглушка от буквы + детерминированный оттенок по имени/адресу).
const MONO_SIZES = {
  sm: "h-7 w-7 text-small",
  md: "h-9 w-9 text-body",
  lg: "h-14 w-14 text-h3",
  xl: "h-20 w-20 text-display-l",
} as const;

/**
 * Аватар: если задан `avatarUrl` — картинка (object-cover, с фолбэком на монограмму при ошибке загрузки);
 * иначе первая буква имени на фоне детерминированного оттенка (channelHue).
 */
export function Monogram({
  name,
  size = "md",
  avatarUrl,
  className,
}: {
  name: string;
  size?: keyof typeof MONO_SIZES;
  avatarUrl?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const ch = (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
  const hue = channelHue(name);
  const showImg = !!avatarUrl && !broken;
  return (
    <div
      className={cn(
        "relative grid flex-none place-items-center overflow-hidden rounded-full font-display font-semibold",
        MONO_SIZES[size],
        className,
      )}
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
      aria-hidden
    >
      {showImg ? (
        // Аватары — произвольные внешние URL, next/image требует allowlist хостов → обычный <img>.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        ch
      )}
    </div>
  );
}

// — Иконки-действия (stroke, currentColor) — те же в hero и в компактной липкой плашке. —
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ShareIcon({ done }: { done: boolean }) {
  return (
    <svg {...iconProps} className="h-[18px] w-[18px]">
      {done ? (
        <path d="M20 6 9 17l-5-5" />
      ) : (
        <>
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
        </>
      )}
    </svg>
  );
}

function ExplorerIcon() {
  return (
    <svg {...iconProps} className="h-[18px] w-[18px]">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

const actionBtn =
  "flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg";

/** Ряд иконок-действий канала: поделиться (ссылка) · скопировать payout-адрес · открыть в Solana Explorer. */
export function HeaderActions({ payoutAddress }: { payoutAddress: string }) {
  const [copied, markCopied] = useCopied();
  const [copiedAddr, markCopiedAddr] = useCopied();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className={actionBtn}
        title="Share (copy link)"
        aria-label="Share"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            markCopied();
            toast({ variant: "success", title: "Link copied" });
          } catch {
            toast({ variant: "error", title: "Couldn't copy" });
          }
        }}
      >
        <ShareIcon done={copied} />
      </button>
      <button
        type="button"
        className={actionBtn}
        title="Copy payout address"
        aria-label="Copy address"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(payoutAddress);
            markCopiedAddr();
            toast({ variant: "success", title: "Address copied" });
          } catch {
            toast({ variant: "error", title: "Couldn't copy" });
          }
        }}
      >
        {copiedAddr ? (
          <CheckIcon className="h-[18px] w-[18px]" />
        ) : (
          <CopyIcon className="h-[18px] w-[18px]" />
        )}
      </button>
      <a
        className={actionBtn}
        href={explorerAddressUrl(payoutAddress)}
        target="_blank"
        rel="noopener noreferrer"
        title="Payout address on Solana Explorer"
        aria-label="Open in explorer"
      >
        <ExplorerIcon />
      </a>
    </div>
  );
}
