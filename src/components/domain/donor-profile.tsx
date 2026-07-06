"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { inputsFromLinks, LinkEditor, type LinkInputs, linksFromInputs } from "./link-editor";
import { OpenCycles } from "./open-cycles";
import { TierBadge } from "./standing";
import { CumulativeAreaChart, RangeTabs, type ChartRange } from "./area-chart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { useDonorOverview, useProfile, useUpdateProfile } from "@/lib/data/hooks";
import type { DonorChannelStanding, DonorOverview, DonorPointEvent } from "@/lib/data/types";
import {
  channelHue,
  cn,
  collapseWhitespace,
  formatPoints,
  formatUSDCNumber,
  fromMicro,
  plural,
  timeAgo,
} from "@/lib/utils";

const DONATIONS = ["crown", "crowns", "crowns"] as const;
const CHANNELS = ["realm", "realms", "realms"] as const;
const POINTS = ["Reign", "Reign", "Reign"] as const;

/** Profile avatar: the donor's uploaded avatar if set, else a monogram with a stable color from name/address. */
export function ProfileAvatar({
  name,
  address,
  avatarUrl,
}: {
  name?: string;
  address: string;
  avatarUrl?: string;
}) {
  const [broken, setBroken] = useState(false);
  const seed = name?.trim() || address;
  const initial = seed.replace(/^@/, "").slice(0, 1).toUpperCase();
  const hue = channelHue(seed);
  const showImg = !!avatarUrl && !broken;
  return (
    <div
      className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full font-display text-h3"
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
    >
      {showImg ? (
        // Avatars are arbitrary external/data URLs; next/image needs a host allowlist → plain <img>.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}

// — Our take on a polymarket-style profile: money (crowns) aggregates, Reign is PER-realm
//   (invariant §4.3, there is no global rating). Headline + chart = "total crowned" over time;
//   "positions" = standing across realms; "activity" = crown history.

function monthYear(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Icon "copy" button (address / link) with a checkmark confirmation. */
function CopyIconButton({ value, title }: { value: string; title: string }) {
  const [copied, markCopied] = useCopied();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          markCopied();
          toast({ variant: "success", title: "Copied" });
        } catch {
          toast({ variant: "error", title: "Couldn't copy" });
        }
      }}
    >
      {copied ? <CheckIcon className="h-[18px] w-[18px]" /> : <CopyIcon className="h-[18px] w-[18px]" />}
    </button>
  );
}

/**
 * Profile bio: a single line — the text is truncated with an ellipsis, "…more" sits inline on the same
 * line to the right (it doesn't grow the card or its grid neighbor). Clicking "…more" opens a dialog with
 * the full description.
 */
function ProfileBio({ bio }: { bio: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bio]);

  return (
    <div className="flex w-full items-baseline gap-1">
      <span ref={ref} className="min-w-0 truncate text-small text-fg-muted">
        {bio}
      </span>
      {clamped ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-small text-fg-faint transition-colors hover:text-fg"
            >
              …more
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>About</DialogTitle>
            </DialogHeader>
            <p className="whitespace-pre-wrap break-words text-body text-fg-muted">{bio}</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Pencil → dialog for editing your own profile (name, about, links). Same form as /me/profile. */
function ProfileEditDialog({ address }: { address: string }) {
  const profileQ = useProfile(address || null);
  const update = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [linkInputs, setLinkInputs] = useState<LinkInputs>([]);

  // Prefill from the profile; re-read on open (in case it was edited in another tab).
  useEffect(() => {
    const p = profileQ.data;
    if (p && open) {
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
      setLinkInputs(inputsFromLinks(p.links));
    }
  }, [profileQ.data, open]);

  function save() {
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        links: linksFromInputs(linkInputs),
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Profile saved" });
          setOpen(false);
        },
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Edit profile"
          aria-label="Edit profile"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          <PencilIcon className="h-[18px] w-[18px]" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name, avatar and links are visible in the feed, the leaderboard and on this profile.
            The profile is optional.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            maxLength={40}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Textarea
            label="About"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            showCount
          />
          <div className="flex flex-col gap-2">
            <span className="text-small text-fg-muted">Links</span>
            <LinkEditor value={linkInputs} onChange={setLinkInputs} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={update.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={save} loading={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// Caption under the chart for the selected range.
const RANGE_CAPTION: Record<ChartRange, string> = {
  "1D": "past day",
  "1W": "past week",
  "1M": "past month",
  "1Y": "past year",
  ALL: "all time",
};

/**
 * Cumulative "total crowned" chart — shared component (area-chart): even steps per crown,
 * a sharp jump on each crown. Here we only convert crowns → events (t, increment in USDC).
 */
function DonationsAreaChart({
  pointEvents,
  range,
}: {
  pointEvents: DonorPointEvent[];
  range: ChartRange;
}) {
  // Строим из ДЕНЕЖНЫХ событий журнала (DONATION + эскроу-GAME_DONATION), а не из серверных `donations`:
  // в icp-режиме это канон канистры (иначе график не сходится с «Total crowned» и теряет эскроу-донаты).
  const events = useMemo(
    () =>
      pointEvents
        .filter((e) => e.type === "DONATION" || e.type === "GAME_DONATION")
        .map((e) => ({ t: Date.parse(e.ts), v: fromMicro(e.amount) })),
    [pointEvents],
  );
  return (
    <CumulativeAreaChart
      events={events}
      range={range}
      formatValue={formatUSDCNumber}
      emptyHint="No crowns yet — the chart appears after the first one."
    />
  );
}

/** Position row: realm + tier + local Reign + crowned. Clickable → realm page. */
function PositionRow({ s }: { s: DonorChannelStanding }) {
  const name = s.channelName?.trim() || `@${s.handle}`;
  const hue = channelHue(name);
  return (
    <Link
      href={`/c/${s.handle}`}
      className="group flex items-center gap-3 border-b border-border py-3"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-small"
        style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
      >
        {name.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-fg transition-colors group-hover:text-status">{name}</div>
        <div className="mono truncate text-small text-fg-faint">@{s.handle}</div>
      </div>
      <div className="hidden shrink-0 sm:block">
        {s.tier ? <TierBadge tier={s.tier} /> : null}
      </div>
      <div className="hidden min-w-[5rem] shrink-0 flex-col items-end sm:flex">
        <span className="mono whitespace-nowrap text-fg">{formatPoints(s.points)}</span>
        <span className="text-small text-fg-faint">{plural(s.points, POINTS)}</span>
      </div>
      <div className="flex min-w-[6rem] shrink-0 flex-col items-end">
        <Amount micro={s.totalDonated} variant="money" className="whitespace-nowrap" />
        <span className="text-small text-fg-faint">crowned</span>
      </div>
    </Link>
  );
}

/** Activity row: realm (link) + amount + time + text (if shown). */
/** Reign log row: realm + "why" (crown $X / operator deduction) + Reign delta (+/−). */
function ActivityRow({
  e,
  handle,
  channelName,
}: {
  e: DonorPointEvent;
  handle?: string;
  channelName?: string;
}) {
  // Seam: in its backend the operator's ADMIN_VOID was removed (CLAUDE.md §4.5) — that event no longer exists.
  const isVoid = false;
  const shown = e.message?.state === "SHOWN";
  const delta = e.pointsDelta;
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex items-center justify-between gap-2">
        {handle ? (
          <Link href={`/c/${handle}`} className="min-w-0 truncate text-small text-fg hover:text-status">
            {channelName?.trim() ? channelName : `@${handle}`}
            {channelName?.trim() ? <span className="mono text-fg-faint"> · @{handle}</span> : null}
          </Link>
        ) : (
          <span className="mono min-w-0 truncate text-small text-fg-faint">{e.channelId}</span>
        )}
        {/* Reign delta: + credited / − deducted */}
        <span
          className="mono shrink-0 text-small font-medium"
          style={{ color: delta < 0 ? "var(--danger)" : "var(--money)" }}
        >
          {delta >= 0 ? "+" : "−"}
          {formatPoints(Math.abs(delta))} {plural(Math.abs(delta), POINTS)}
        </span>
      </div>

      {/* why */}
      {isVoid ? (
        <p className="text-small text-danger">Voided by operator — illegal content.</p>
      ) : (
        <div className="flex items-center gap-1.5 text-small text-fg-muted">
          <span>Crown</span>
          <Amount micro={e.amount} variant="money" />
        </div>
      )}
      {!isVoid && shown && e.message ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(e.message.text)}</p>
      ) : null}

      <div className="flex items-center gap-2 text-small text-fg-faint">
        <span title={e.ts}>{timeAgo(e.ts)}</span>
        {e.txSignature ? (
          <a
            href={explorerTxUrl(e.txSignature)}
            target="_blank"
            rel="noreferrer"
            title="Transaction in explorer"
            aria-label="Transaction in explorer"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        ) : null}
        {/* Спор — не ончейн-tx: пруф это табло, где виден открывший (его подпись проверила канистра) + голоса/вердикт. */}
        {(e.type === "DISPUTE_WON" || e.type === "DISPUTE_LOST") && e.disputeTaskId && handle ? (
          <Link
            href={`/c/${handle}/dispute/${encodeURIComponent(e.disputeTaskId)}`}
            title="Open the dispute board — who raised it, votes, verdict"
            aria-label="Dispute board"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

type Tab = "channels" | "activity";
type PosSort = "donated" | "points";

function DonorDashboard({
  overview,
  displayName,
  editable,
}: {
  overview: DonorOverview;
  displayName?: string;
  editable?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("channels");
  const [range, setRange] = useState<ChartRange>("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PosSort>("donated");
  const [actLimit, setActLimit] = useState(12);
  const [actChannel, setActChannel] = useState("all"); // filter the activity feed by realm
  const profileQ = useProfile(overview.address || null);
  // Guard against an old response with no Reign log (e.g. a stale server store) — don't crash.
  const pointEvents = useMemo(() => overview.pointEvents ?? [], [overview.pointEvents]);

  // Realm by id → handle/name (for labels in the activity feed).
  const handleById = useMemo(() => {
    const m = new Map<string, { handle: string; channelName?: string }>();
    for (const s of overview.standings) m.set(s.channelId, { handle: s.handle, channelName: s.channelName });
    return m;
  }, [overview.standings]);

  // Realms that have activity (for the filter) + the filtered feed.
  const actChannels = useMemo(() => {
    const ids = [...new Set(pointEvents.map((e) => e.channelId))];
    return ids.map((id) => {
      const ref = handleById.get(id);
      return { id, label: ref?.channelName?.trim() || (ref ? `@${ref.handle}` : id) };
    });
  }, [pointEvents, handleById]);
  const filteredEvents =
    actChannel === "all" ? pointEvents : pointEvents.filter((e) => e.channelId === actChannel);

  const positions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? overview.standings.filter(
          (s) =>
            s.handle.toLowerCase().includes(q) || (s.channelName?.toLowerCase().includes(q) ?? false),
        )
      : overview.standings;
    const sorted = [...filtered].sort((a, b) =>
      sort === "points"
        ? b.points - a.points
        : b.totalDonated > a.totalDonated
          ? 1
          : b.totalDonated < a.totalDonated
            ? -1
            : 0,
    );
    return sorted;
  }, [overview.standings, query, sort]);

  const name = displayName?.trim() || profileQ.data?.displayName?.trim() || "Supporter profile";

  return (
    <div className="flex flex-col gap-8">
      {/* ADR 0018: on YOUR own profile, open cycles go up top ("needs you"); the profile = personal base. */}
      {editable ? <OpenCycles /> : null}
      {/* Identity + chart — two cards in a row, equal height (stretch), in a dark tone (bg --bg). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Identity card — modeled on the realm header (label + large name + meta with counters). */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start gap-4">
            <ProfileAvatar name={name} address={overview.address} avatarUrl={overview.avatarUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Profile</span>
              <h1 className="text-display-l leading-tight text-fg">{name}</h1>
              <div className="mono truncate text-small text-fg-faint">{overview.address}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-muted">
                <span>
                  <span className="font-medium text-fg">{overview.channelsSupported}</span>{" "}
                  {plural(overview.channelsSupported, CHANNELS)}
                </span>
                <span className="text-fg-faint">·</span>
                <span>
                  <span className="font-medium text-fg">{overview.donationCount}</span>{" "}
                  {plural(overview.donationCount, DONATIONS)}
                </span>
                <span className="text-fg-faint">·</span>
                <span>since {monthYear(overview.firstDonationAt)}</span>
              </div>
              {overview.ownedChannelHandle ? (
                <Link
                  href={`/c/${overview.ownedChannelHandle}`}
                  className="mt-1 inline-flex w-fit items-center gap-1 rounded-pill border border-border px-2.5 py-0.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-status"
                >
                  Realm @{overview.ownedChannelHandle} →
                </Link>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CopyIconButton value={overview.address} title="Copy address" />
              {editable ? <ProfileEditDialog address={overview.address} /> : null}
            </div>
          </div>

          {profileQ.data?.bio ? <ProfileBio bio={profileQ.data.bio} /> : null}
          {profileQ.data?.links?.length ? (
            <ChannelLinkButtons links={profileQ.data.links} variant="text" />
          ) : null}
        </div>

        {/* "Total crowned" card + chart */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-[var(--bg)] p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-small text-fg-muted">Total crowned</span>
            <RangeTabs range={range} onChange={setRange} />
          </div>
          <Amount micro={overview.totalDonated} variant="money" className="text-display-l" />
          <DonationsAreaChart pointEvents={pointEvents} range={range} />
          <span className="text-small text-fg-faint">
            {RANGE_CAPTION[range]} · money is final, Reign is computed per realm separately
          </span>
        </div>
      </div>

      {/* Tabs — neutral underline, the counter = section heading. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 border-b border-border">
          {(
            [
              ["channels", `Realms · ${overview.channelsSupported}`],
              ["activity", `Reign log · ${pointEvents.length}`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-body transition-colors",
                tab === key ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "channels" ? (
          overview.standings.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <Input
                    icon={<SearchIcon className="h-4 w-4" />}
                    placeholder="Search realms…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                  {(
                    [
                      ["donated", "By amount"],
                      ["points", "By Reign"],
                    ] as [PosSort, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSort(key)}
                      className={cn(
                        "rounded px-2.5 py-1 text-small transition-colors",
                        sort === key ? "bg-surface-raised text-fg" : "text-fg-faint hover:text-fg",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {positions.length > 0 ? (
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {positions.map((s) => (
                    <PositionRow key={s.channelId} s={s} />
                  ))}
                </div>
              ) : (
                <p className="text-small text-fg-faint">Nothing found.</p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
              This address hasn&apos;t crowned any realm yet.
            </p>
          )
        ) : pointEvents.length > 0 ? (
          <div className="flex flex-col gap-3">
            {actChannels.length > 1 ? (
              <Select
                value={actChannel}
                onChange={(e) => {
                  setActChannel(e.target.value);
                  setActLimit(12);
                }}
                aria-label="Filter log by realm"
                className="w-full sm:w-64"
              >
                <option value="all">All realms</option>
                {actChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            ) : null}
            {filteredEvents.length > 0 ? (
              <>
                <div className="flex flex-col [&>:last-child]:border-b-0">
                  {filteredEvents.slice(0, actLimit).map((e) => {
                    const ref = handleById.get(e.channelId);
                    return (
                      <ActivityRow
                        key={e.id}
                        e={e}
                        handle={ref?.handle}
                        channelName={ref?.channelName}
                      />
                    );
                  })}
                </div>
                {filteredEvents.length > actLimit ? (
                  <button
                    type="button"
                    onClick={() => setActLimit((n) => n + 12)}
                    className="mx-auto rounded-pill border border-border px-4 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                  >
                    Show more
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-small text-fg-faint">No log entries for this realm.</p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-small text-fg-faint">
            The Reign log is empty.
          </p>
        )}
      </div>
    </div>
  );
}

/** Supporter profile in a dashboard style: identity + money over time + standing/activity.
 *  editable=true (your own /me page) adds the pencil profile editor. */
export function DonorProfile({ address, editable }: { address: string; editable?: boolean }) {
  const overviewQ = useDonorOverview(address || null);
  const profileQ = useProfile(address || null);

  if (overviewQ.isLoading) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!overviewQ.data) {
    return <p className="text-small text-fg-faint">Couldn&apos;t load the profile.</p>;
  }
  return (
    <DonorDashboard
      overview={overviewQ.data}
      displayName={profileQ.data?.displayName}
      editable={editable}
    />
  );
}
