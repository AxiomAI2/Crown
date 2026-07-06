"use client";

import Link from "next/link";
import { useState } from "react";
import { Amount } from "@/components/domain/amount";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useChannel } from "@/lib/data/hooks";
import { cn, shortAddress } from "@/lib/utils";
import { useDisputeVotes } from "./hooks";
import type { VoteChoice } from "./types";

/**
 * A full dispute page (scaled to thousands of voters): all parties + a paginated list of votes with
 * search by address, filter by side, and sorting. Votes load PAGE BY PAGE from the server (game-bus
 * `disputeVotes`), not all at once. Each participant is clickable to their profile.
 */
const PAGE_SIZE = 50;
const choiceLabel = (c: VoteChoice) => (c === "completed" ? "completed" : "not completed");
const choiceColor = (c: VoteChoice) => (c === "completed" ? "var(--money)" : "var(--danger)");

function PartyLink({ address }: { address: string }) {
  return (
    <Link href={`/u/${address}`} className="mono text-small text-info hover:underline">
      {shortAddress(address)}
    </Link>
  );
}

export function DisputePage({ handle, taskId }: { handle: string; taskId: string }) {
  const channelQ = useChannel(handle);
  const channel = channelQ.data;
  const [page, setPage] = useState(0);
  const [side, setSide] = useState<VoteChoice | null>(null);
  const [sort, setSort] = useState<"weight" | "recent">("weight");
  const [q, setQ] = useState("");

  const votesQ = useDisputeVotes(channel?.id, taskId, { page, pageSize: PAGE_SIZE, side, sort, q });
  const data = votesQ.data;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <Link href={`/c/${handle}`} className="text-small text-fg-muted hover:text-fg">
          ← Realm @{handle}
        </Link>
        <h1 className="text-display-l text-fg">Task dispute</h1>

        {channelQ.isLoading || votesQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : votesQ.error ? (
          <ErrorState description="Couldn't load the dispute." onRetry={() => votesQ.refetch()} />
        ) : !channel || !data?.found || !data.task || !data.dispute ? (
          <EmptyState title="Dispute not found" description="There may be no dispute for this task." />
        ) : (
          <>
            {/* Task + parties */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <Amount micro={BigInt(data.task.amount)} variant="money" />
                <span className="text-caption rounded-pill border border-border px-2 py-0.5 text-fg-faint">
                  {data.task.resolution
                    ? `Outcome: ${data.task.resolution.outcome === "to_streamer" ? "to content maker" : "refund to supporter"}`
                    : "Voting in progress"}
                </span>
              </div>
              <p className="text-body break-words text-fg">{data.task.text}</p>
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <Party label="Content maker (performed)" address={channel.ownerAddress} />
                <Party label="Supporter (paid)" address={data.task.donor} />
                <Party label="Disputing" address={data.dispute.by} />
              </div>
            </div>

            {/* Vote aggregate */}
            <Tally tally={data.dispute.tally} quorum={data.dispute.quorum} />

            {/* List controls */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <Input
                    placeholder="Search by address…"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <Segmented
                  value={side ?? "all"}
                  onChange={(v) => {
                    setSide(v === "all" ? null : (v as VoteChoice));
                    setPage(0);
                  }}
                  options={[
                    ["all", "All"],
                    ["completed", "Completed"],
                    ["not_completed", "Not completed"],
                  ]}
                />
                <Segmented
                  value={sort}
                  onChange={(v) => {
                    setSort(v as "weight" | "recent");
                    setPage(0);
                  }}
                  options={[
                    ["weight", "By weight"],
                    ["recent", "Recent"],
                  ]}
                />
              </div>

              {data.votes.length === 0 ? (
                <EmptyState title="Nothing found" description="No votes match the filter." />
              ) : (
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {data.votes.map((v) => (
                    <div
                      key={v.voter}
                      className="flex items-center justify-between gap-2 border-b border-border py-2"
                    >
                      <PartyLink address={v.voter} />
                      <div className="flex items-center gap-3">
                        <span className="text-small" style={{ color: choiceColor(v.choice) }}>
                          {choiceLabel(v.choice)}
                        </span>
                        <span className="mono text-small text-fg">{v.weight} pts</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              <div className="text-small flex items-center justify-between gap-2 text-fg-faint">
                <span>{data.total} total · weight = Reign points at dispute time</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Back
                  </Button>
                  <span className="mono">
                    {page + 1} / {Math.max(1, Math.ceil(data.total / PAGE_SIZE))}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Party({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-small text-fg-muted">{label}</span>
      <PartyLink address={address} />
    </div>
  );
}

function Tally({
  tally,
  quorum,
}: {
  tally: {
    completed: number;
    not: number;
    completedVotes: number;
    notVotes: number;
    total: number;
  };
  quorum: number;
}) {
  const cPct = tally.total > 0 ? (tally.completed / tally.total) * 100 : 50;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-[var(--bg)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col items-start">
          <span className="text-small" style={{ color: "var(--money)" }}>
            Completed
          </span>
          <span className="mono text-small text-fg">{tally.completed} points</span>
          <span className="text-caption text-fg-faint">{tally.completedVotes} vote(s)</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-small" style={{ color: "var(--danger)" }}>
            Not completed
          </span>
          <span className="mono text-small text-fg">{tally.not} points</span>
          <span className="text-caption text-fg-faint">{tally.notVotes} vote(s)</span>
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div style={{ width: `${cPct}%`, backgroundColor: "var(--money)" }} />
        <div style={{ width: `${100 - cPct}%`, backgroundColor: "var(--danger)" }} />
      </div>
      <span className="mono text-caption text-fg-faint">
        weight {tally.total} / quorum {quorum}
        {tally.total >= quorum ? "" : " · quorum not reached"}
      </span>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "text-small rounded px-2.5 py-1 transition-colors",
            value === key ? "bg-surface-raised text-fg" : "text-fg-faint hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
