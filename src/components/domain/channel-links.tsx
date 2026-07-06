"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { platformDef } from "@/lib/channel-links";
import type { ChannelLink, ChannelLinkPlatform } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** Platform logo (simple-icons, currentColor). Color is set from outside via `color`/text-*. */
export function PlatformIcon({
  platform,
  className,
  brand,
}: {
  platform: ChannelLinkPlatform;
  className?: string;
  brand?: boolean; // true → brand color; otherwise inherits currentColor
}) {
  const def = platformDef(platform);
  if (!def) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("overflow-visible", className)}
      fill="currentColor"
      style={brand ? { color: def.color } : undefined}
      aria-hidden="true"
    >
      <path d={def.iconPath} />
    </svg>
  );
}

/** A single "pill" link with a logo. Points to the canonical profile/realm, opens in a new tab. */
function LinkPill({ link }: { link: ChannelLink }) {
  const def = platformDef(link.platform);
  if (!def) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={def.label}
      className="group inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
    >
      <PlatformIcon platform={link.platform} brand className="h-4 w-4 shrink-0" />
      <span>{def.label}</span>
    </a>
  );
}

/** A single plain-text link (no icon/pill) — for a light, airy look in the realm header. */
function LinkText({ link }: { link: ChannelLink }) {
  const def = platformDef(link.platform);
  if (!def) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={def.label}
      className="text-small text-fg-muted transition-colors hover:text-fg"
    >
      {def.label}
    </a>
  );
}

/**
 * Realm/profile links. variant="pill" (default) — buttons with logos; variant="text" — a simple
 * text row (as in the realm header). A long list doesn't stretch the block: we show at most `max`, and hide the rest
 * behind "+N" — clicking pops up a mini-dialog (Dialog) with ALL the links.
 */
export function ChannelLinkButtons({
  links,
  max = 4,
  variant = "pill",
}: {
  links: ChannelLink[];
  max?: number;
  variant?: "pill" | "text";
}) {
  const valid = links.filter((l) => platformDef(l.platform));
  if (!valid.length) return null;
  const text = variant === "text";

  // Hide behind "+N" only if there are ≥ 2 hidden — otherwise "+N" would take the same space as a single link.
  const collapse = valid.length > max + 1;
  const shown = collapse ? valid.slice(0, max) : valid;
  const hiddenCount = valid.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center", text ? "gap-x-4 gap-y-1" : "gap-2")}>
      {shown.map((l) =>
        text ? <LinkText key={l.url} link={l} /> : <LinkPill key={l.url} link={l} />,
      )}
      {collapse ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              title={`${hiddenCount} more — show all links`}
              aria-label={`${hiddenCount} more links — show all`}
              className={
                text
                  ? "text-small text-fg-faint transition-colors hover:text-fg"
                  : "inline-flex items-center rounded-pill border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              }
            >
              {text ? `+${hiddenCount}` : `… +${hiddenCount}`}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Links</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              {valid.map((l) => (
                <LinkPill key={l.url} link={l} />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
