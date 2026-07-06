"use client";

import { useState } from "react";
import { CrownLogo } from "@/components/crown-logo";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { useCopied } from "@/components/ui/use-copied";
import { useMyChannel } from "@/lib/data/hooks";

/** OBS browser-source widgets for the realm. Each links to a public, read-only overlay under /overlay/[handle]. */
const WIDGETS: { key: string; name: string; desc: string; size: string }[] = [
  {
    key: "alerts",
    name: "Crown alerts",
    desc: "An animated card pops up on every new crown — donor, amount and their message (only after you show it in moderation).",
    size: "800 × 240",
  },
  {
    key: "top",
    name: "Top supporters",
    desc: "A live top-5 leaderboard of your realm by crowned volume.",
    size: "380 × 420",
  },
  {
    key: "total",
    name: "Total crowned",
    desc: "A running counter of everything crowned to your realm.",
    size: "420 × 160",
  },
];

export function RealmWidgets() {
  const channelQ = useMyChannel();
  const handle = channelQ.data?.handle;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (channelQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!handle) {
    return <EmptyState title="No realm yet" description="Create your realm to get stream widgets." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Widgets</h1>
        <p className="max-w-2xl text-fg-muted">
          Overlays for your stream. In OBS add a <span className="text-fg">Browser Source</span> and paste the
          URL below. Each overlay is <span className="text-fg">public and read-only</span> (no wallet needed) and
          has a transparent background — only the widget shows on stream.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {WIDGETS.map((w) => (
          <WidgetCard key={w.key} widget={w} url={`${origin}/overlay/${handle}/${w.key}`} />
        ))}
      </div>

      <p className="max-w-2xl text-caption text-fg-faint">
        Tip: set the Browser Source to the recommended size and enable “Shutdown source when not visible” off, so
        alerts keep polling. Overlays read your live realm data — in local dev (mock) a separate OBS window has its
        own empty data; use the preview here or the hosted backend.
      </p>
    </div>
  );
}

function WidgetCard({
  widget,
  url,
}: {
  widget: { key: string; name: string; desc: string; size: string };
  url: string;
}) {
  const [copied, markCopied] = useCopied();
  const [busy, setBusy] = useState(false);

  async function copy() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(url);
      markCopied();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-money-bg text-money">
            <CrownLogo size={18} />
          </span>
          <div className="flex flex-col">
            <span className="text-body font-medium text-fg">{widget.name}</span>
            <span className="text-caption text-fg-faint">Recommended size {widget.size}</span>
          </div>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-border px-3 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          Preview <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      </div>

      <p className="text-small text-fg-muted">{widget.desc}</p>

      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-[var(--bg)] px-3 py-2 text-small text-fg-muted">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={busy}
          aria-label="Copy overlay URL"
          className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-border px-3 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
        >
          {copied ? <CheckIcon className="h-4 w-4 text-status" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
