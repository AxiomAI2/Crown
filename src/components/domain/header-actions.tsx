"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import { channelHue, cn } from "@/lib/utils";

// Monogram sizes (letter-based fallback avatar + deterministic hue from name/address).
const MONO_SIZES = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-small",
  md: "h-9 w-9 text-body",
  lg: "h-14 w-14 text-h3",
  xl: "h-20 w-20 text-display-l",
} as const;

/**
 * Avatar: if `avatarUrl` is set — an image (object-cover, falling back to the monogram on load error);
 * otherwise the first letter of the name on a deterministic hue background (channelHue).
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
        // Avatars are arbitrary external URLs; next/image requires a host allowlist → plain <img>.
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

// — Action icons (stroke, currentColor) — the same in the hero and in the compact sticky bar. —
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

/** Row of realm action icons: share (link) · copy payout address · open in Solana Explorer. */
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
