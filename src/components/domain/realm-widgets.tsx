"use client";

import { useEffect, useState } from "react";
import { GoalBar, GOAL_DEFAULTS } from "@/components/domain/goal-bar";
import { CrownLogo } from "@/components/crown-logo";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { useChannelConfig, useLeaderboard, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";
import type { GoalTheme } from "@/lib/data/types";
import { cn, fromMicro, renderRowTemplate, toMicro } from "@/lib/utils";

/** OBS browser-source widgets for the realm. Each links to a public, read-only overlay under /overlay/[handle]. */
const WIDGETS: { key: string; name: string; desc: string; size: string }[] = [
  {
    key: "alerts",
    name: "Crown alerts",
    desc: "An animated card on every new crown.",
    size: "800 × 240",
  },
  {
    key: "goal",
    name: "Donation goal",
    desc: "A progress bar toward your target.",
    size: "520 × 90",
  },
  {
    key: "top",
    name: "Top supporters",
    desc: "Live top-5 of your realm.",
    size: "380 × 420",
  },
  {
    key: "total",
    name: "Total crowned",
    desc: "A running total of crowns.",
    size: "420 × 160",
  },
];

/** `view` splits the (overloaded) widgets tab into sub-pages: overlays (OBS cards) · goal · list. Omit → all. */
export function RealmWidgets({ view }: { view?: "overlays" | "goal" | "list" }) {
  const channelQ = useMyChannel();
  const channel = channelQ.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [ttsOn, setTtsOn] = useState(false);

  if (channelQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!channel) {
    return <EmptyState title="No realm yet" description="Create your realm to get stream widgets." />;
  }

  const showObs = !view || view === "overlays"; // alerts / top / total OBS cards
  const showGoal = !view || view === "goal"; // the goal card + its design editor
  const showList = !view || view === "list"; // the donations-list builder
  // Goal has its own sub-page; the plain OBS overlays share theirs.
  const cards = WIDGETS.filter((w) => (w.key === "goal" ? showGoal : showObs));
  const META = {
    overlays: { title: "Overlays", sub: "OBS browser sources — paste a URL into a Browser Source." },
    goal: { title: "Donation goal", sub: "A live progress bar toward your target, with a full design editor." },
    list: { title: "Donations list", sub: "A configurable list of last donations or top supporters for OBS." },
  } as const;
  const head = view
    ? META[view]
    : { title: "Widgets", sub: "Paste a URL into an OBS Browser Source — that's it." };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">{head.title}</h1>
        <p className="max-w-2xl text-fg-muted">{head.sub}</p>
      </div>

      {cards.length > 0 ? (
        <div className="flex flex-col gap-4">
          {cards.map((w) => {
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
                    Read alerts aloud (TTS)
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
      ) : null}

      {showList ? <DonationsListBuilder handle={channel.handle} origin={origin} /> : null}

      {showObs ? (
        <p className="max-w-2xl text-small text-fg-faint">
          In OBS turn off “Shutdown source when not visible” so alerts keep updating.
        </p>
      ) : null}
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

// Fill-gradient presets for the goal bar (like DA's preset library) — [from, to, track].
const GOAL_PRESETS: { name: string; from: string; to: string; track: string }[] = [
  { name: "Gold", from: "#f57507", to: "#f59c07", track: "#424242" },
  { name: "Magenta", from: "#d6249f", to: "#fd5949", track: "#2a2130" },
  { name: "Cyan", from: "#12c2e9", to: "#25aae1", track: "#122a30" },
  { name: "Crimson", from: "#8e0e00", to: "#c31432", track: "#2a1416" },
  { name: "Emerald", from: "#11998e", to: "#38ef7d", track: "#12261f" },
  { name: "Violet", from: "#7c5cff", to: "#a855f7", track: "#1e1730" },
];

interface GoalDraft {
  target: string; // USDC
  start: string; // USDC head-start baseline
  deadline: string; // datetime-local value ("" = none)
  label: string;
  theme: Required<Omit<GoalTheme, "bgColor">> & { bgColor: string };
}

// ISO ⇄ <input type="datetime-local"> value. The input has no timezone; we treat it as local and store UTC ISO.
function isoToLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Preview backdrops: a game-like scene (readability over real footage) and a transparency checkerboard.
const GAME_BG =
  "radial-gradient(340px 200px at 18% 28%, rgba(126,168,92,0.38), transparent 70%), " +
  "radial-gradient(420px 260px at 78% 64%, rgba(58,112,72,0.42), transparent 70%), " +
  "radial-gradient(240px 160px at 55% 15%, rgba(210,190,120,0.16), transparent 70%), " +
  "linear-gradient(180deg, #33452a, #10180e)";
const CHECKER_BG = {
  backgroundImage:
    "conic-gradient(#232323 0 25%, #191919 0 50%, #232323 0 75%, #191919 0)",
  backgroundSize: "18px 18px",
} as const;

/** Goal builder — competitor-grade: a live status row (ring, raised / target), a preview over a game scene or
 *  transparency, a preset library with mini bar previews, and Elements / Indicator / Font tabs. */
function GoalEditor({ channelId }: { channelId: string }) {
  const configQ = useChannelConfig(channelId);
  const boardQ = useLeaderboard(channelId, "all_time");
  const update = useUpdateConfig(channelId);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [designTab, setDesignTab] = useState<"elements" | "indicator" | "font">("elements");
  const [gameBg, setGameBg] = useState(true);

  useEffect(() => {
    const c = configQ.data;
    if (!c) return;
    setDraft({
      target: c.goalTarget && c.goalTarget > 0n ? String(Math.round(fromMicro(c.goalTarget))) : "",
      start: c.goalStart && c.goalStart > 0n ? String(Math.round(fromMicro(c.goalStart))) : "",
      deadline: isoToLocalInput(c.goalDeadline),
      label: c.goalLabel ?? "",
      theme: { ...GOAL_DEFAULTS, bgColor: "", ...c.goalTheme },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data?.version, configQ.data?.updatedAt]);

  if (configQ.isLoading || !draft) return <Skeleton className="h-64 w-full rounded-md" />;

  const setT = (patch: Partial<GoalDraft["theme"]>) =>
    setDraft((d) => (d ? { ...d, theme: { ...d.theme, ...patch } } : d));
  const set = (patch: Partial<GoalDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const targetNum = Number(draft.target);
  const startNum = Number(draft.start);
  const target = draft.target.trim() && Number.isFinite(targetNum) && targetNum > 0 ? toMicro(targetNum) : 0n;
  const start = draft.start.trim() && Number.isFinite(startNum) && startNum > 0 ? toMicro(startNum) : 0n;

  // LIVE numbers for the status row: head-start + everything actually crowned (same math as the overlay).
  const crowned = (boardQ.data ?? []).reduce((s, e) => s + e.totalDonated, 0n);
  const savedTarget = configQ.data?.goalTarget ?? 0n;
  const savedStart = configQ.data?.goalStart ?? 0n;
  const liveRaised = savedStart + crowned;
  const livePct =
    savedTarget > 0n ? (liveRaised >= savedTarget ? 100 : Number((liveRaised * 100n) / savedTarget)) : 0;

  // Preview: the bar at ~55% of the target so all elements read (raised includes the head-start).
  const sampleTarget = target > 0n ? target : toMicro(10000);
  const previewRaised = start + (sampleTarget * 55n) / 100n;
  const sampleDeadline = draft.deadline ? localInputToIso(draft.deadline) : undefined;

  function save() {
    if (!draft) return;
    update.mutate(
      {
        goalTarget: target,
        goalStart: start > 0n ? start : undefined,
        goalDeadline: localInputToIso(draft.deadline),
        goalLabel: draft.label.trim() || undefined,
        goalTheme: { ...draft.theme, bgColor: draft.theme.bgColor.trim() || undefined },
      },
      {
        onSuccess: () => toast({ variant: "success", title: target > 0n ? "Goal saved" : "Goal cleared" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save goal", description: String(e) }),
      },
    );
  }

  const tabs = [
    { key: "elements" as const, label: "Elements" },
    { key: "indicator" as const, label: "Indicator" },
    { key: "font" as const, label: "Font" },
  ];

  return (
    <div className="flex flex-col gap-5 rounded-md border border-border bg-[var(--bg)] p-4">
      {/* Live status of the RUNNING goal (saved config, real crowned money) — like the competitors' top bar. */}
      {savedTarget > 0n ? (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3">
          <ProgressRing pct={livePct} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-small font-medium text-fg">
              {configQ.data?.goalLabel?.trim() || "Donation goal"}
            </span>
            <span className="mono text-small text-fg-muted">
              Raised: ${Math.round(fromMicro(liveRaised)).toLocaleString("en-US")} / $
              {Math.round(fromMicro(savedTarget)).toLocaleString("en-US")}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { goalTarget: 0n, goalStart: undefined, goalDeadline: undefined },
                {
                  onSuccess: () => toast({ variant: "success", title: "Goal finished" }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't finish", description: String(e) }),
                },
              )
            }
          >
            ■ Finish goal
          </Button>
        </div>
      ) : null}

      {/* Setup: the "new fundraiser" fields */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Target (USDC)"
          mono
          inputMode="decimal"
          placeholder="10000"
          value={draft.target}
          onChange={(e) => set({ target: e.target.value.replace(/[^0-9.]/g, "") })}
        />
        <Input
          label="Start from (USDC)"
          mono
          inputMode="decimal"
          placeholder="0"
          value={draft.start}
          onChange={(e) => set({ start: e.target.value.replace(/[^0-9.]/g, "") })}
        />
        <Input
          label="Caption"
          placeholder="New streaming PC"
          value={draft.label}
          onChange={(e) => set({ label: e.target.value })}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-fg-muted">End date (optional)</span>
          <input
            type="datetime-local"
            value={draft.deadline}
            onChange={(e) => set({ deadline: e.target.value })}
            className="h-10 rounded-md border border-border bg-[var(--bg)] px-3 text-small text-fg outline-none [color-scheme:dark] transition-colors focus-visible:border-border-strong"
          />
        </label>
      </div>

      {/* Widget design: preview over a game scene ↔ transparency, next to the preset library. */}
      <div className="flex flex-col gap-4">
        <span className="text-caption uppercase tracking-wide text-fg-faint">Widget design</span>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* Preview */}
          <div
            className="relative flex min-h-[190px] items-center overflow-hidden rounded-lg p-5"
            style={
              draft.theme.bgColor.trim()
                ? { background: draft.theme.bgColor.trim() }
                : gameBg
                  ? { background: GAME_BG }
                  : CHECKER_BG
            }
          >
            <GoalBar
              raised={previewRaised}
              target={sampleTarget}
              label={draft.label.trim() || "New streaming PC"}
              deadlineIso={sampleDeadline}
              theme={draft.theme}
            />
            <label className="absolute bottom-2.5 left-2.5 flex items-center gap-2 rounded-pill bg-black/60 px-2.5 py-1 backdrop-blur-sm">
              <span className="text-caption text-white/85">Game background</span>
              <Switch checked={gameBg} onCheckedChange={setGameBg} srLabel="Game background" />
            </label>
          </div>

          {/* Preset library — mini previews of the actual bar. */}
          <div className="grid content-start grid-cols-2 gap-2">
            {GOAL_PRESETS.map((p, idx) => {
              const active = draft.theme.fillFrom === p.from && draft.theme.fillTo === p.to;
              return (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  onClick={() => setT({ fillFrom: p.from, fillTo: p.to, trackColor: p.track })}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border bg-black/40 p-2.5 text-left transition-colors",
                    active ? "border-money" : "border-border hover:border-border-strong",
                  )}
                >
                  <span className="text-caption text-fg-faint">#{idx + 1}</span>
                  <div className="pointer-events-none">
                    <GoalBar
                      raised={5500_000000n}
                      target={10000_000000n}
                      theme={{
                        ...draft.theme,
                        fillFrom: p.from,
                        fillTo: p.to,
                        trackColor: p.track,
                        height: 14,
                        radius: 7,
                        borderWidth: 0,
                        textSize: 8,
                        titlePos: "hidden",
                        showRemaining: false,
                        showBounds: false,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Design tabs: Elements / Indicator / Font */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setDesignTab(t.key)}
              className={cn(
                "relative px-3 py-2 text-small transition-colors",
                designTab === t.key ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {designTab === t.key ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-money" />
              ) : null}
            </button>
          ))}
        </div>

        {designTab === "elements" ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldSelect
                label="Caption position"
                value={draft.theme.titlePos}
                onChange={(v) => setT({ titlePos: v as GoalTheme["titlePos"] })}
                options={[
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
                  { value: "hidden", label: "Hidden" },
                ]}
              />
              <FieldSelect
                label="Progress text"
                value={draft.theme.progressLabel}
                onChange={(v) => setT({ progressLabel: v as GoalTheme["progressLabel"] })}
                options={[
                  { value: "amount_pct", label: "$5,500 (55%)" },
                  { value: "amount_target", label: "$5,500 / $10,000" },
                  { value: "pct", label: "55%" },
                ]}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                <span className="text-small text-fg-muted">Remaining time</span>
                <Switch
                  checked={draft.theme.showRemaining}
                  onCheckedChange={(v) => setT({ showRemaining: v })}
                  srLabel="Show remaining time"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                <span className="text-small text-fg-muted">$0 … target bounds</span>
                <Switch
                  checked={draft.theme.showBounds}
                  onCheckedChange={(v) => setT({ showBounds: v })}
                  srLabel="Show bounds"
                />
              </div>
            </div>
            <ColorField
              label="Widget background"
              value={draft.theme.bgColor}
              onChange={(v) => setT({ bgColor: v })}
              allowEmpty
              helper="Empty = transparent on stream. A solid color (e.g. #00ff00) for chroma-key."
            />
          </div>
        ) : null}

        {designTab === "indicator" ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <RangeField label="Height" value={draft.theme.height} min={10} max={60} unit="px" onChange={(v) => setT({ height: v })} />
              <RangeField label="Corner radius" value={draft.theme.radius} min={0} max={30} unit="px" onChange={(v) => setT({ radius: v })} />
              <RangeField label="Outline" value={draft.theme.borderWidth} min={0} max={6} unit="px" onChange={(v) => setT({ borderWidth: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Track color" value={draft.theme.trackColor} onChange={(v) => setT({ trackColor: v })} />
              <ColorField label="Fill — start" value={draft.theme.fillFrom} onChange={(v) => setT({ fillFrom: v })} />
              <ColorField label="Fill — end" value={draft.theme.fillTo} onChange={(v) => setT({ fillTo: v })} />
              <RangeField label="Fill angle" value={draft.theme.fillAngle} min={0} max={360} unit="°" onChange={(v) => setT({ fillAngle: v })} />
            </div>
          </div>
        ) : null}

        {designTab === "font" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <RangeField label="Text size" value={draft.theme.textSize} min={10} max={28} unit="px" onChange={(v) => setT({ textSize: v })} />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span className="text-small text-fg-muted">Bold text</span>
              <Switch
                checked={draft.theme.textBold}
                onCheckedChange={(v) => setT({ textBold: v })}
                srLabel="Bold text"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button size="sm" onClick={save} loading={update.isPending}>
          {target > 0n ? "Save goal" : "Clear goal"}
        </Button>
      </div>
    </div>
  );
}

/** Circular progress ring for the live goal status (SVG, no deps). */
function ProgressRing({ pct }: { pct: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="relative grid h-11 w-11 flex-none place-items-center">
      <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--surface-raised)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="var(--money)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
        />
      </svg>
      <span className="mono absolute text-[10px] font-semibold text-fg">{clamped}%</span>
    </span>
  );
}

/** Range slider + numeric readout, matching the design tokens. */
function RangeField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-small text-fg-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-pill bg-surface-raised accent-[var(--money)]"
        />
        <span className="mono w-14 shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-center text-[12px] text-fg">
          {value}
          {unit}
        </span>
      </div>
    </label>
  );
}

/** Color swatch + hex input. `allowEmpty` keeps an empty string (transparent) rather than forcing a color. */
function ColorField({
  label,
  value,
  onChange,
  allowEmpty,
  helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  helper?: string;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <input
          type="color"
          aria-label={label}
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 flex-none cursor-pointer rounded border border-border bg-surface"
        />
        <div className="flex-1">
          <Input
            label={label}
            mono
            placeholder={allowEmpty ? "transparent" : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
      {helper ? <span className="text-small text-fg-faint">{helper}</span> : null}
    </div>
  );
}

/** Small styled native <select> matching the design tokens. */
function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-small text-fg-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-border bg-[var(--bg)] px-3 text-small text-fg outline-none transition-colors focus-visible:border-border-strong"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const SAMPLE_ROWS = [
  { username: "Ray Tracing", amount: "$80", message: "gg wp" },
  { username: "TaxOffice", amount: "$404", message: "" },
  { username: "Rick the Roller", amount: "$68", message: "nice one" },
  { username: "Rowdy", amount: "$275", message: "" },
  { username: "TaxOffice", amount: "$536", message: "" },
  { username: "Zephyr", amount: "$12", message: "hi" },
];

/**
 * Configurable "donations list" OBS widget (competitor parity): data type / period / count / row template with
 * {username} {amount} {message} tags. Stateless — the config lives entirely in the browser-source URL query, so
 * there's no backend. The overlay is /overlay/[handle]/list?type=…&period=…&count=…&tpl=…&title=…
 */
function DonationsListBuilder({ handle, origin }: { handle: string; origin: string }) {
  const [title, setTitle] = useState("All-time donations");
  const [type, setType] = useState<"last" | "top">("last");
  const [period, setPeriod] = useState<"all" | "month">("all");
  const [count, setCount] = useState(5);
  const [tpl, setTpl] = useState("{username} - {amount}");
  const [copied, mark] = useCopied();

  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  params.set("type", type);
  params.set("period", period);
  params.set("count", String(count));
  params.set("tpl", tpl);
  const url = `${origin}/overlay/${handle}/list?${params.toString()}`;

  const previewRows = SAMPLE_ROWS.slice(0, count);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-money-bg text-money">
            <CrownLogo size={18} />
          </span>
          <div className="flex flex-col">
            <span className="text-body font-medium text-fg">Donations list</span>
            <span className="text-caption text-fg-faint">Configurable — last donations or top supporters</span>
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

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
        {/* Controls */}
        <div className="flex flex-col gap-3">
          <Input label="Title" placeholder="Optional heading" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <FieldSelect
              label="Data type"
              value={type}
              onChange={(v) => setType(v as "last" | "top")}
              options={[
                { value: "last", label: "Last donations" },
                { value: "top", label: "Top supporters" },
              ]}
            />
            <FieldSelect
              label="Period"
              value={period}
              onChange={(v) => setPeriod(v as "all" | "month")}
              options={[
                { value: "all", label: "All time" },
                { value: "month", label: "This month" },
              ]}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-fg-muted">Number of items — {count}</span>
            <input
              type="range"
              min={1}
              max={15}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-[var(--money)]"
            />
          </label>
          <Input
            label="Row template"
            mono
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            helper="Available tags: {username}, {amount}, {message}"
          />
        </div>

        {/* Live preview */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-black/60 p-3">
          <span className="mb-1 block text-caption uppercase tracking-wide text-fg-faint">Preview</span>
          {title.trim() ? <div className="font-display text-body font-semibold text-fg">{title}</div> : null}
          {previewRows.map((r, i) => (
            <div key={i} className="truncate text-small font-semibold text-fg">
              {renderRowTemplate(tpl, r)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-[var(--bg)] px-3 py-2 text-small text-fg-muted">
          {url}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            mark();
          }}
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
