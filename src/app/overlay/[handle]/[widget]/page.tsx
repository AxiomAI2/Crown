"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CrownLogo } from "@/components/crown-logo";
import { useData } from "@/lib/data/context";
import type { Donation, LeaderboardEntry } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

/**
 * Public OBS overlays (browser sources). Read-only by realm handle — no wallet/session, so they can be dropped
 * into OBS as a Browser Source. The page forces a transparent background so only the widget is captured.
 * Widgets: `alerts` (animated crown alert on each new donation), `top` (top supporters), `total` (crowned counter).
 * NOTE: overlays read the SAME data source as the app (api/chain). In local `mock` mode a separate OBS browser
 * has its own empty store — previews from the owner's own tab work, but a real OBS capture needs the live backend.
 */
export default function OverlayPage() {
  const params = useParams<{ handle: string; widget: string }>();
  const handle = String(params.handle ?? "");
  const widget = String(params.widget ?? "");
  const data = useData();

  // OBS captures the page as-is → make the document transparent while the overlay is mounted.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.background, b: body.style.background };
    html.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      html.style.background = prev.h;
      body.style.background = prev.b;
    };
  }, []);

  const channelQ = useQuery({
    queryKey: ["overlay", "channel", handle],
    queryFn: () => data.getChannel(handle),
    staleTime: 60_000,
  });
  const channelId = channelQ.data?.id ?? null;

  if (!channelId) return null; // transparent until the realm resolves (or forever if the handle is wrong)

  return (
    <div className="min-h-screen w-full overflow-hidden p-4 font-body text-fg">
      {widget === "alerts" ? <AlertsWidget channelId={channelId} /> : null}
      {widget === "top" ? <TopWidget channelId={channelId} /> : null}
      {widget === "total" ? <TotalWidget channelId={channelId} /> : null}
      {widget === "goal" ? <GoalWidget channelId={channelId} /> : null}
    </div>
  );
}

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

/** Text shadow so the widget stays legible over ANY stream background. */
const SHADOW = { textShadow: "0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)" } as const;

// — Alerts: pop an animated card for each NEW crown ————————————————————————————————————————————————
const ALERT_MS = 7000;

function AlertsWidget({ channelId }: { channelId: string }) {
  const data = useData();
  const donationsQ = useQuery({
    queryKey: ["overlay", "donations", channelId],
    queryFn: () => data.listDonations(channelId),
    refetchInterval: 4000,
  });
  const items = useMemo<Donation[]>(
    () => [...(donationsQ.data?.items ?? [])].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
    [donationsQ.data?.items],
  );

  const seen = useRef<Set<string> | null>(null); // null → not seeded yet
  const [queue, setQueue] = useState<Donation[]>([]);
  const [current, setCurrent] = useState<Donation | null>(null);
  // Text-to-speech: opt-in via `?tts=1` on the browser-source URL (OBS has no UI to toggle it live).
  const [tts] = useState(
    () => typeof window !== "undefined" && /[?&]tts=(1|true)\b/.test(window.location.search),
  );

  // Diff each poll: on the FIRST load, mark everything as seen (don't replay history when OBS starts).
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(items.map((d) => d.id));
      return;
    }
    const fresh = items.filter((d) => !seen.current!.has(d.id));
    if (fresh.length === 0) return;
    fresh.forEach((d) => seen.current!.add(d.id));
    setQueue((q) => [...q, ...fresh]);
  }, [items]);

  // Show one alert at a time for ALERT_MS.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrent(next ?? null); // queue is non-empty here (guarded above); ?? null satisfies noUncheckedIndexedAccess
    setQueue(rest);
    const t = window.setTimeout(() => setCurrent(null), ALERT_MS);
    return () => window.clearTimeout(t);
  }, [queue, current]);

  // Read the alert aloud (opt-in). Speak name + amount, and the message ONLY if it's been shown (§4.6).
  useEffect(() => {
    if (!current || !tts || typeof window === "undefined" || !window.speechSynthesis) return;
    const dollars = Math.round(fromMicro(current.amount));
    const spokenName = current.donorName?.trim() || "Someone"; // never read out a raw wallet address
    const spokenMsg = current.message?.state === "SHOWN" ? current.message.text?.trim() : "";
    const phrase = `${spokenName} crowned ${dollars} dollar${dollars === 1 ? "" : "s"}${spokenMsg ? `. ${spokenMsg}` : ""}`;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(phrase));
  }, [current, tts]);

  if (!current) return null;

  const name = current.donorName?.trim() || `${current.donor.slice(0, 4)}…${current.donor.slice(-4)}`;
  // Invariant §4.6: donation text is private until moderated. A public overlay may reveal it ONLY once SHOWN.
  // The amount/name are always public (§4.7 money ≠ text).
  const msg = current.message?.state === "SHOWN" ? current.message.text?.trim() : undefined;
  return (
    <div className="animate-stamp flex items-start gap-4 rounded-2xl border border-money-dim bg-black/70 p-5 backdrop-blur-sm" style={{ maxWidth: 720 }}>
      <span className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-full bg-money-bg text-money">
        {current.donorAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.donorAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <CrownLogo size={30} />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline gap-2" style={SHADOW}>
          <span className="truncate font-display text-2xl font-semibold text-fg">{name}</span>
          <span className="text-fg-muted">crowned</span>
          <span className="mono font-display text-2xl font-semibold text-money">{usd(current.amount)}</span>
        </div>
        {msg ? <p className="text-body text-fg" style={SHADOW}>{msg}</p> : null}
      </div>
    </div>
  );
}

// — Top supporters —————————————————————————————————————————————————————————————————————————————————
function TopWidget({ channelId }: { channelId: string }) {
  const data = useData();
  const boardQ = useQuery({
    queryKey: ["overlay", "board", channelId],
    queryFn: () => data.getLeaderboard(channelId, "all_time"),
    refetchInterval: 15_000,
  });
  const top = (boardQ.data ?? []).slice(0, 5);
  if (top.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-black/70 p-5 backdrop-blur-sm" style={{ maxWidth: 380 }}>
      <div className="flex items-center gap-2 text-caption uppercase tracking-wide text-money" style={SHADOW}>
        <CrownLogo size={16} className="text-money" /> Top supporters
      </div>
      {top.map((e: LeaderboardEntry) => {
        const name = e.displayName?.trim() || `${e.donor.slice(0, 4)}…${e.donor.slice(-4)}`;
        return (
          <div key={e.donor} className="flex items-center gap-3" style={SHADOW}>
            <span className="mono w-5 flex-none text-right text-fg-faint">{e.rank}</span>
            <span className="min-w-0 flex-1 truncate text-body text-fg">{name}</span>
            <span className="mono flex-none text-money">{usd(e.totalDonated)}</span>
          </div>
        );
      })}
    </div>
  );
}

// — Total crowned counter ——————————————————————————————————————————————————————————————————————————
function TotalWidget({ channelId }: { channelId: string }) {
  const data = useData();
  const boardQ = useQuery({
    queryKey: ["overlay", "board", channelId],
    queryFn: () => data.getLeaderboard(channelId, "all_time"),
    refetchInterval: 10_000,
  });
  const total = (boardQ.data ?? []).reduce((s, e) => s + e.totalDonated, 0n);

  return (
    <div className="flex w-fit flex-col gap-1 rounded-2xl border border-money-dim bg-black/70 px-6 py-4 backdrop-blur-sm" style={SHADOW}>
      <span className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-money">
        <CrownLogo size={14} className="text-money" /> Crowned
      </span>
      <span className="mono font-display text-5xl font-semibold text-money">{usd(total)}</span>
    </div>
  );
}

// — Donation goal progress bar (target set in Widgets → Customization) ————————————————————————————————
function GoalWidget({ channelId }: { channelId: string }) {
  const data = useData();
  const cfgQ = useQuery({
    queryKey: ["overlay", "config", channelId],
    queryFn: () => data.getChannelConfig(channelId),
    refetchInterval: 30_000,
  });
  const boardQ = useQuery({
    queryKey: ["overlay", "board", channelId],
    queryFn: () => data.getLeaderboard(channelId, "all_time"),
    refetchInterval: 10_000,
  });

  const target = cfgQ.data?.goalTarget ?? 0n;
  if (target <= 0n) return null; // no goal set → render nothing

  const total = (boardQ.data ?? []).reduce((s, e) => s + e.totalDonated, 0n);
  // Integer percent via bigint math (no float) — capped at 100.
  const pct = total >= target ? 100 : Number((total * 100n) / target);
  const label = cfgQ.data?.goalLabel?.trim() || "Goal";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-money-dim bg-black/70 p-5 backdrop-blur-sm" style={{ maxWidth: 520 }}>
      <div className="flex items-center justify-between gap-2 text-body text-fg" style={SHADOW}>
        <span className="flex items-center gap-1.5 font-medium">
          <CrownLogo size={16} className="text-money" /> {label}
        </span>
        <span className="mono text-money">
          {usd(total)} <span className="text-fg-faint">/ {usd(target)}</span>
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-pill bg-black/60">
        <div className="h-full rounded-pill bg-money transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
