"use client";

import { useEffect, useState } from "react";
import { CrownLogo } from "@/components/crown-logo";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { useChannelConfig, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";
import { fromMicro, toMicro } from "@/lib/utils";

/** OBS browser-source widgets for the realm. Each links to a public, read-only overlay under /overlay/[handle]. */
const WIDGETS: { key: string; name: string; desc: string; size: string }[] = [
  {
    key: "alerts",
    name: "Crown alerts",
    desc: "An animated card pops up on every new crown — donor, amount and their message (only after you show it in moderation).",
    size: "800 × 240",
  },
  {
    key: "goal",
    name: "Donation goal",
    desc: "A progress bar toward a target you set below. Hidden on stream until a target is set.",
    size: "520 × 90",
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
  const channel = channelQ.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [ttsOn, setTtsOn] = useState(false);

  if (channelQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!channel) {
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
        {WIDGETS.map((w) => {
          const url = `${origin}/overlay/${channel.handle}/${w.key}`;
          if (w.key === "alerts") {
            return (
              <WidgetCard key={w.key} widget={w} url={ttsOn ? `${url}?tts=1` : url}>
                <label className="flex w-fit items-center gap-2 text-small text-fg-muted">
                  <input
                    type="checkbox"
                    checked={ttsOn}
                    onChange={(e) => setTtsOn(e.target.checked)}
                    className="h-4 w-4 accent-[var(--money)]"
                  />
                  Read alerts aloud (Text-to-Speech) — appends <code className="mono">?tts=1</code>
                </label>
              </WidgetCard>
            );
          }
          if (w.key === "goal") {
            return (
              <WidgetCard key={w.key} widget={w} url={url}>
                <GoalEditor channelId={channel.id} />
              </WidgetCard>
            );
          }
          return <WidgetCard key={w.key} widget={w} url={url} />;
        })}
      </div>

      <p className="max-w-2xl text-caption text-fg-faint">
        Tip: set the Browser Source to the recommended size and turn OFF “Shutdown source when not visible”, so
        alerts keep polling. Overlays read your live realm data — in local dev (mock) a separate OBS window has its
        own empty data; use the preview here or the hosted backend.
      </p>
    </div>
  );
}

function WidgetCard({
  widget,
  url,
  children,
}: {
  widget: { key: string; name: string; desc: string; size: string };
  url: string;
  children?: React.ReactNode;
}) {
  const [copied, markCopied] = useCopied();

  async function copy() {
    await navigator.clipboard.writeText(url);
    markCopied();
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
      {children}

      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-[var(--bg)] px-3 py-2 text-small text-fg-muted">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy overlay URL"
          className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-border px-3 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          {copied ? <CheckIcon className="h-4 w-4 text-status" /> : <CopyIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Set the donation goal target ($) and caption — stored in the realm config, read by the `goal` overlay. */
function GoalEditor({ channelId }: { channelId: string }) {
  const configQ = useChannelConfig(channelId);
  const update = useUpdateConfig(channelId);

  const savedTarget = configQ.data?.goalTarget ?? 0n;
  const savedLabel = configQ.data?.goalLabel ?? "";
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");

  // Seed the fields from the saved config once it loads.
  useEffect(() => {
    if (!configQ.data) return;
    setAmount(savedTarget > 0n ? String(Math.round(fromMicro(savedTarget))) : "");
    setLabel(savedLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data]);

  const amountNum = Number(amount);
  const nextTarget = amount.trim() && Number.isFinite(amountNum) && amountNum > 0 ? toMicro(amountNum) : 0n;
  const dirty = nextTarget !== savedTarget || label.trim() !== savedLabel.trim();

  function save() {
    update.mutate(
      { goalTarget: nextTarget, goalLabel: label.trim() || undefined },
      {
        onSuccess: () =>
          toast({ variant: "success", title: nextTarget > 0n ? "Goal saved" : "Goal cleared" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save goal", description: String(e) }),
      },
    );
  }

  if (configQ.isLoading) return <Skeleton className="h-10 w-full rounded-md" />;

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-[var(--bg)] p-3">
      <div className="w-32">
        <Input
          label="Target (USDC)"
          mono
          inputMode="decimal"
          placeholder="2000"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>
      <div className="min-w-[10rem] flex-1">
        <Input
          label="Caption (optional)"
          placeholder="New streaming PC"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <Button size="sm" onClick={save} loading={update.isPending} disabled={!dirty}>
        {nextTarget > 0n ? "Save goal" : "Clear goal"}
      </Button>
    </div>
  );
}
