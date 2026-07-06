"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import type { EscrowTask, TaskOutcome } from "@/games/escrow-task/types";
import { useData } from "@/lib/data/context";
import { useDiscovery } from "@/lib/data/hooks";
import { cn, collapseWhitespace, fromMicro, shortAddress } from "@/lib/utils";

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

const OUTCOME_LABEL: Record<TaskOutcome, string> = {
  to_streamer: "To streamer",
  to_donor: "Refund to supporter",
};
// Live (non-terminal) status → label + accent. Terminal tasks show their resolution instead.
const STATUS: Record<Exclude<EscrowTask["status"], "RESOLVED">, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting streamer", cls: "border-border text-fg-muted" },
  ACCEPTED: { label: "In progress", cls: "border-info text-info" },
  DONE: { label: "Dispute window", cls: "border-warn text-warn" },
  DISPUTED: { label: "Dispute voting", cls: "border-danger text-danger" },
};

type StatusFilter = "all" | "live" | "resolved" | "disputed";

interface Row {
  task: EscrowTask;
  handle: string;
  createdMs: number;
}

/**
 * Admin → Mini-games: the full HISTORY of every mini-game (escrow task) across all realms — realm that
 * created it, donor, amount, result and date. Platform-wide distribution charts (adoption / by-status) moved
 * to the Dashboard. Empty until realms run tasks — no fakes.
 */
export default function AdminGamesPage() {
  const provider = useData();
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);
  const handleById = useMemo(
    () => new Map(realms.map((r) => [r.channelId, r.handle] as const)),
    [realms],
  );

  const taskQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["game", "escrow-task", r.channelId] as const,
      queryFn: () =>
        provider.gameQuery({ gameId: "escrow-task", channelId: r.channelId, op: "list" }) as Promise<{
          tasks: EscrowTask[];
        }>,
      staleTime: 30_000,
    })),
  });
  const loading = isLoading || taskQs.some((q) => q.isLoading);

  const rows = useMemo<Row[]>(() => {
    return taskQs
      .flatMap((q) => q.data?.tasks ?? [])
      .map((task) => ({
        task,
        handle: handleById.get(task.channelId) ?? task.channelId,
        createdMs: Date.parse(task.createdAt),
      }))
      .sort((a, b) => b.createdMs - a.createdMs); // newest first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQs.map((q) => q.dataUpdatedAt).join(","), handleById]);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const visible = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "resolved") return r.task.status === "RESOLVED";
    if (filter === "disputed") return !!r.task.dispute;
    return r.task.status !== "RESOLVED"; // "live"
  });

  const value = rows.reduce((s, r) => s + BigInt(r.task.amount), 0n);

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-fg">Mini-games</h1>
          <p className="text-small text-fg-faint">
            Every escrow task across all realms — {rows.length} total · {usd(value)} in play. Adoption and
            status charts are on the Dashboard.
          </p>
        </div>
        {rows.length > 0 ? <FilterToggle value={filter} onChange={setFilter} /> : null}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : error ? (
        <ErrorState description="Couldn't load mini-games." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No mini-games yet"
          description="Tasks appear here once streamers enable a game and supporters create them."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing here" description="No tasks match this filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-caption uppercase tracking-wide text-fg-faint">
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-left font-medium">Realm</th>
                <th className="px-4 py-2.5 text-left font-medium">Task</th>
                <th className="px-4 py-2.5 text-left font-medium">Supporter</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ task, handle }) => (
                <tr key={task.id} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-fg-faint">{shortDate(task.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/c/${handle}`} className="mono text-fg transition-colors hover:text-status">
                      @{handle}
                    </Link>
                  </td>
                  <td className="max-w-[22rem] px-4 py-3">
                    <span className="line-clamp-2 text-fg-muted">{collapseWhitespace(task.text)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/u/${task.donor}`}
                      className="mono text-fg-muted transition-colors hover:text-status"
                    >
                      {shortAddress(task.donor)}
                    </Link>
                  </td>
                  <td className="mono whitespace-nowrap px-4 py-3 text-right text-money">
                    {usd(BigInt(task.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <ResultCell task={task} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Result of a task: terminal → outcome + a note about a dispute; live → the current status. */
function ResultCell({ task }: { task: EscrowTask }) {
  if (task.resolution) {
    const toStreamer = task.resolution.outcome === "to_streamer";
    const disputed = !!task.dispute;
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className="w-fit rounded-pill border px-2 py-0.5 text-caption"
          style={{
            color: toStreamer ? "var(--money)" : "var(--danger)",
            borderColor: toStreamer ? "var(--money)" : "var(--danger)",
          }}
        >
          {OUTCOME_LABEL[task.resolution.outcome]}
        </span>
        <span className="text-caption text-fg-faint">
          {disputed
            ? `after dispute · ${task.dispute!.votes.length} votes`
            : task.resolution.reason.replace(/_/g, " ")}
        </span>
      </div>
    );
  }
  const st = STATUS[task.status as Exclude<EscrowTask["status"], "RESOLVED">];
  return (
    <span className={cn("w-fit rounded-pill border px-2 py-0.5 text-caption", st.cls)}>{st.label}</span>
  );
}

function FilterToggle({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  const opts: { k: StatusFilter; label: string }[] = [
    { k: "all", label: "All" },
    { k: "live", label: "Live" },
    { k: "disputed", label: "Disputed" },
    { k: "resolved", label: "Resolved" },
  ];
  return (
    <div
      role="group"
      aria-label="Filter tasks by status"
      className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5"
    >
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          aria-pressed={value === o.k}
          className={cn(
            "rounded-md px-3 py-1 text-small transition-colors",
            value === o.k ? "bg-money-bg text-money" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
