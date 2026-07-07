"use client";

import { useEffect, useState } from "react";
import { Amount } from "./amount";
import { ModeratorEditor } from "./channel-settings-editor";
import { ModerationItem } from "./moderation";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Pager, usePager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useEscrowAction, useEscrowTasks } from "@/games/escrow-task/hooks";
import { dueResolution } from "@/games/escrow-task/machine";
import {
  useChannelConfig,
  useDonations,
  useManagedChannels,
  useModerationQueue,
  useMyChannel,
  useSetMessageState,
  useUpdateConfig,
} from "@/lib/data/hooks";
import type { ChannelConfig, ModeratorRef } from "@/lib/data/types";
import { cn, collapseWhitespace, shortAddress } from "@/lib/utils";

/** Moderation queue (Personal Space → My Realm). Realms: owner OR moderator (useManagedChannels). */
export function ModerationQueue() {
  const managedQ = useManagedChannels();
  const channels = managedQ.data ?? [];
  const myChannelId = useMyChannel().data?.id;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channelId = selectedId ?? channels[0]?.id;

  const queueQ = useModerationQueue(channelId);
  const donationsQ = useDonations(channelId);
  const setState = useSetMessageState(channelId ?? "");
  const tasksQ = useEscrowTasks(channelId);
  const taskAction = useEscrowAction(channelId ?? "");
  const nowMs = Date.now();
  const heldTasks = (tasksQ.data?.tasks ?? []).filter(
    (t) => t.textState === "HELD" && t.status !== "RESOLVED" && !dueResolution(t, nowMs),
  );

  const byDonation = new Map((donationsQ.data?.items ?? []).map((d) => [d.id, d]));
  const pg = usePager(queueQ.data ?? [], 10);

  if (managedQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (channels.length === 0) {
    return (
      <EmptyState
        title="No realms to moderate"
        description="Create your own realm, or ask an owner to add your wallet as a moderator."
      />
    );
  }

  const messages = queueQ.data ?? [];
  const heldCount = messages.length + heldTasks.length;
  const currentChannel = channels.find((c) => c.id === channelId);
  const isOwner = !!channelId && channelId === myChannelId; // only the OWNER edits realm settings

  function act(messageId: string, state: "SHOWN" | "HIDDEN") {
    setState.mutate(
      { messageId, state },
      {
        onSuccess: () => toast({ title: state === "SHOWN" ? "Shown" : "Hidden" }),
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  function taskAct(taskId: string, state: "SHOWN" | "HIDDEN") {
    taskAction.mutate(
      { op: "setTextState", payload: { taskId, state } },
      {
        onSuccess: () => toast({ title: state === "SHOWN" ? "Shown" : "Hidden" }),
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-display-l text-fg">Moderation queue</h1>
            {heldCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-money-bg px-2.5 py-0.5 text-small text-money">
                <span className="h-1.5 w-1.5 rounded-pill bg-money" />
                {heldCount} in moderation
              </span>
            ) : null}
          </div>
          <p className="text-fg-muted">
            Text is private until shown — you only decide its fate. Money is separate: crowns are already
            credited, and a task&apos;s escrow returns to the supporter on its own timer if left undone.
          </p>
        </div>
        {channels.length > 1 ? (
          <Select
            value={channelId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Realm"
            className="sm:w-56"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.handle}
              </option>
            ))}
          </Select>
        ) : currentChannel ? (
          <span className="mono shrink-0 text-small text-fg-faint">@{currentChannel.handle}</span>
        ) : null}
      </div>

      {/* Settings live right here (owner only) — the policy that governs this very queue. */}
      {isOwner && channelId ? <ModerationSettings channelId={channelId} /> : null}

      {queueQ.isLoading || tasksQ.isLoading ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : queueQ.error ? (
        <ErrorState description="Couldn't load the queue." onRetry={() => queueQ.refetch()} />
      ) : messages.length === 0 && heldTasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            title="Queue is clear"
            description="New crowns-with-text and tasks awaiting your decision will show up here."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {messages.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-caption uppercase tracking-wide text-fg-faint">
                Messages · {messages.length}
              </h2>
              <div className="rounded-lg border border-border bg-surface px-4">
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {pg.pageItems.map((m) => {
                    const d = byDonation.get(m.donationId);
                    return (
                      <ModerationItem
                        key={m.id}
                        message={m}
                        donor={d?.donor}
                        donorName={d?.donorName}
                        amount={d?.amount}
                        pending={setState.isPending && setState.variables?.messageId === m.id}
                        onShow={() => act(m.id, "SHOWN")}
                        onHide={() => act(m.id, "HIDDEN")}
                      />
                    );
                  })}
                </div>
                {pg.pageCount > 1 ? (
                  <div className="border-t border-border py-3">
                    <Pager
                      page={pg.page}
                      pageCount={pg.pageCount}
                      total={pg.total}
                      pageSize={pg.pageSize}
                      setPage={pg.setPage}
                      setPageSize={pg.setPageSize}
                    />
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {heldTasks.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-caption uppercase tracking-wide text-fg-faint">
                Tasks · {heldTasks.length}
              </h2>
              <div className="rounded-lg border border-border bg-surface px-4">
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {heldTasks.map((t) => (
                    <div key={t.id} className="flex flex-col gap-2 border-b border-border py-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono truncate text-small text-fg">{shortAddress(t.donor)}</span>
                        <Amount micro={BigInt(t.amount)} variant="money" />
                      </div>
                      <p className="break-words text-body text-fg">{collapseWhitespace(t.text)}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={taskAction.isPending}
                          onClick={() => taskAct(t.id, "SHOWN")}
                        >
                          Show
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={taskAction.isPending}
                          onClick={() => taskAct(t.id, "HIDDEN")}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

const TEXT_MODES: { value: ChannelConfig["textShowMode"]; label: string; hint: string }[] = [
  { value: "manual", label: "Manual approval", hint: "Every crown text waits here for your Show / Hide." },
  {
    value: "auto_if_clean",
    label: "Auto-show if clean",
    hint: "Clean text publishes instantly; only flagged text is held here. Hard-block categories are never auto-shown.",
  },
];

/**
 * Moderation settings, inline in the queue tab (owner only) — the policy that decides what lands in THIS queue:
 * how crown text is published (manual vs auto-if-clean, instant save) and who can moderate (moderators, saved
 * on demand). The same config as Customization → My Realm, surfaced where it's acted on. Collapsed by default.
 */
function ModerationSettings({ channelId }: { channelId: string }) {
  const configQ = useChannelConfig(channelId);
  const update = useUpdateConfig(channelId);
  const config = configQ.data;
  const [open, setOpen] = useState(false);

  const [mods, setMods] = useState<ModeratorRef[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [wordDraft, setWordDraft] = useState("");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (config && !seeded) {
      setMods(config.moderators);
      setWords(config.blockedWords ?? []);
      setSeeded(true);
    }
  }, [config, seeded]);

  if (!config) return null;
  const modsDirty = JSON.stringify(mods) !== JSON.stringify(config.moderators);
  const wordsDirty = JSON.stringify(words) !== JSON.stringify(config.blockedWords ?? []);

  function addWords() {
    const parts = wordDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setWords((prev) => {
      const next = [...prev];
      for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
      return next;
    });
    setWordDraft("");
  }
  function saveWords() {
    update.mutate(
      { blockedWords: words },
      {
        onSuccess: () => toast({ variant: "success", title: "Banned words saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  function setMode(mode: ChannelConfig["textShowMode"]) {
    if (mode === config!.textShowMode) return;
    update.mutate(
      { textShowMode: mode },
      {
        onSuccess: () => toast({ variant: "success", title: "Moderation mode saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }
  function saveMods() {
    update.mutate(
      { moderators: mods },
      {
        onSuccess: () => toast({ variant: "success", title: "Moderators saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-small text-fg">
          Moderation settings
          <span className="text-caption text-fg-faint">
            {config.textShowMode === "manual" ? "Manual approval" : "Auto-show if clean"}
            {config.moderators.length > 0 ? ` · ${config.moderators.length} mod` : ""}
            {(config.blockedWords?.length ?? 0) > 0 ? ` · ${config.blockedWords!.length} banned` : ""}
          </span>
        </span>
        <ChevronDownIcon className={cn("h-4 w-4 text-fg-faint transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="flex flex-col gap-6 border-t border-border p-4">
          {/* Text publishing policy — instant save (like a toggle). */}
          <div className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">How crown text is published</span>
            <div className="inline-flex w-fit rounded-lg border border-border bg-[var(--bg)] p-0.5">
              {TEXT_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  disabled={update.isPending}
                  aria-pressed={config.textShowMode === m.value}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-small transition-colors",
                    config.textShowMode === m.value
                      ? "bg-money-bg text-money"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-small text-fg-faint">
              {TEXT_MODES.find((m) => m.value === config.textShowMode)?.hint}
            </p>
          </div>

          {/* Moderators — draft + explicit save. */}
          <div className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Moderators</span>
            <p className="text-small text-fg-faint">
              Wallets you trust to work this queue on your behalf.
            </p>
            <ModeratorEditor value={mods} onChange={setMods} />
            {modsDirty ? (
              <div className="flex gap-2 pt-1">
                <Button variant="money" size="sm" loading={update.isPending} onClick={saveMods}>
                  Save moderators
                </Button>
                <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => setMods(config.moderators)}>
                  Reset
                </Button>
              </div>
            ) : null}
          </div>

          {/* Banned words / symbols — realm-specific. A hit holds the text; the crown & Reign still count. */}
          <div className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Banned words &amp; symbols</span>
            <p className="text-small text-fg-faint">
              Crown text containing any of these is held here for your review — it never auto-publishes. The
              crown and Reign still count. Case-insensitive; matches inside longer text too.
            </p>
            {words.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {words.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 rounded-pill border border-border bg-[var(--bg)] py-0.5 pl-2.5 pr-1 text-small"
                  >
                    <span className="mono text-fg">{w}</span>
                    <button
                      type="button"
                      onClick={() => setWords(words.filter((x) => x !== w))}
                      aria-label={`Remove ${w}`}
                      className="grid h-4 w-4 place-items-center rounded-full text-fg-faint transition-colors hover:bg-surface-2 hover:text-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Input
                label="Add word or symbol"
                value={wordDraft}
                onChange={(e) => setWordDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addWords();
                  }
                }}
                placeholder="e.g. scam, gg, 🤡  (comma-separated)"
                className="flex-1"
              />
              <Button variant="secondary" onClick={addWords} disabled={!wordDraft.trim()}>
                Add
              </Button>
            </div>
            {wordsDirty ? (
              <div className="flex gap-2 pt-1">
                <Button variant="money" size="sm" loading={update.isPending} onClick={saveWords}>
                  Save banned words
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => setWords(config.blockedWords ?? [])}
                >
                  Reset
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
