"use client";

import Link from "next/link";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useModerationAttention, useProfile, useSession } from "@/lib/data/hooks";
import { channelHue } from "@/lib/utils";

/**
 * Signed-in state in the header: ONE control — the account monogram + "Personal Space" (links to /space).
 * No dropdown: profile, address and sign out all live inside Personal Space → Account. The balance chip next
 * to it is rendered separately by HeaderBalance.
 */
export function AccountMenu() {
  const session = useSession();
  const address = session.data?.address ?? null;
  const profile = useProfile(address);
  const { hasPending } = useModerationAttention();

  if (!address) return null;
  const name = profile.data?.displayName?.trim() || address;
  const hue = channelHue(name);
  const initial = name.replace(/^@/, "")[0]?.toUpperCase() ?? "?";

  return (
    <Link
      href="/space"
      className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface pl-3.5 pr-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
    >
      Personal Space
      <span
        className="relative grid h-6 w-6 flex-none place-items-center rounded-full font-display text-[10px]"
        style={{ backgroundColor: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 70% 74%)` }}
        aria-hidden
      >
        {initial}
        {hasPending ? (
          <NotificationDot
            title="Something to review in the studio"
            className="absolute -right-0.5 -top-0.5 ring-2 ring-[var(--bg)]"
          />
        ) : null}
      </span>
    </Link>
  );
}
