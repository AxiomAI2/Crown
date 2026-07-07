"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { EmptyState } from "@/components/ui/feedback";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { Pager, usePager } from "@/components/ui/pager";
import { TaskFeedRow } from "@/games/escrow-task/EscrowTaskPanel";
import type { EscrowTask } from "@/games/escrow-task/types";
import { useLeaderboard, useSession } from "@/lib/data/hooks";
import type { Donation, Tier } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

type FeedItem =
  | { kind: "donation"; key: string; ts: number; hay: string; d: Donation }
  | { kind: "task"; key: string; ts: number; hay: string; t: EscrowTask };

const donationHay = (d: Donation): string =>
  [d.donor, d.donorName ?? "", d.txSignature ?? "", d.message?.text ?? "", d.id, String(fromMicro(d.amount))]
    .join(" ")
    .toLowerCase();

const taskHay = (t: EscrowTask): string =>
  [t.donor, t.text, t.fundTx ?? "", t.id, String(fromMicro(BigInt(t.amount))), t.status, t.resolution?.outcome ?? ""]
    .join(" ")
    .toLowerCase();

/**
 * A unified realm feed: regular crowns + crowns-with-tasks (games) in ONE timeline by time. Each row —
 * the donor's avatar, name + local tier, amount, text (if shown), time. Search — an expanding magnifier;
 * pagination appears only when there are many crowns (the Pager hides itself). The donor's tier comes from the
 * leaderboard (deduped request).
 */
export function ChannelFeed({
  donations,
  tasks,
  handle,
  channelId,
  reportable = false,
  manageChannelId,
}: {
  donations: Donation[];
  tasks: EscrowTask[];
  handle: string; // for the link to a task dispute's details (/c/<handle>/dispute/<taskId>)
  channelId?: string; // for donors' tier badges (leaderboard); optional — without it, just no badges
  reportable?: boolean; // "Report" on shown messages
  manageChannelId?: string; // set → "Ban" the donor (owner/moderator)
}) {
  const viewer = useSession().data?.address ?? null; // for "Report" on tasks
  const [query, setQuery] = useState("");

  // The donor's local tier (for the badge in the feed) — from the realm's leaderboard. Same key as the full
  // donors page/Realm roll → React Query dedupes the request.
  const board = useLeaderboard(channelId, "all_time").data;
  const tierByDonor = useMemo(() => {
    const m = new Map<string, Tier>();
    for (const e of board ?? []) if (e.tier) m.set(e.donor, e.tier);
    return m;
  }, [board]);

  const items = useMemo<FeedItem[]>(() => {
    const ds = donations.map<FeedItem>((d) => ({
      kind: "donation",
      key: `d:${d.id}`,
      ts: Date.parse(d.ts),
      hay: donationHay(d),
      d,
    }));
    const ts = tasks
      .filter((t) => !t.hidden) // ones rejected by the streamer aren't shown in the feed (returned to the donor on a timer)
      .map<FeedItem>((t) => ({
        kind: "task",
        key: `t:${t.id}`,
        ts: Date.parse(t.createdAt),
        hay: taskHay(t),
        t,
      }));
    return [...ds, ...ts].sort((a, b) => b.ts - a.ts); // newest on top
  }, [donations, tasks]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? items.filter((it) => it.hay.includes(q)) : items), [items, q]);
  const pager = usePager(filtered, 25);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption uppercase tracking-wide text-fg-faint">
          Crowns · {items.length}
        </span>
        {items.length > 0 ? (
          <ExpandingSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              pager.setPage(0);
            }}
            placeholder="name, hash, text, amount…"
            label="Search feed"
          />
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing found"
          description={query ? "Try a different search." : "No crowns yet."}
          action={
            query ? undefined : (
              <a
                href={`/c/${handle}#crown`}
                className="inline-flex h-9 items-center rounded-lg border border-money-dim bg-money-bg/40 px-4 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
              >
                Crown first →
              </a>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {pager.pageItems.map((it) =>
              it.kind === "donation" ? (
                <DonationCard
                  key={it.key}
                  donation={it.d}
                  tier={tierByDonor.get(it.d.donor)}
                  variant="row"
                  avatar
                  reportable={reportable}
                  manageChannelId={manageChannelId}
                />
              ) : (
                <TaskFeedRow
                  key={it.key}
                  task={it.t}
                  handle={handle}
                  viewer={viewer}
                  manageChannelId={manageChannelId}
                />
              ),
            )}
          </div>
          <Pager {...pager} />
        </>
      )}
    </div>
  );
}
