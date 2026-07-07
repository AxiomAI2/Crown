"use client";

import { useEffect, useState } from "react";
import { Monogram } from "@/components/domain/header-actions";
import { CrownLogo } from "@/components/crown-logo";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCopied } from "@/components/ui/use-copied";
import { platformDef } from "@/lib/channel-links";
import { useChannelConfig, useMyChannel, useProfile, useUpdateConfig } from "@/lib/data/hooks";
import type { PageTheme } from "@/lib/data/types";
import { cn, pageThemeStyle } from "@/lib/utils";

type BgType = "color" | "gradient" | "image";
interface ThemeDraft {
  bgType: BgType;
  bgColor: string;
  bgGradient: string;
  bgImage: string;
  accent: string;
}

const GRADIENTS = [
  "linear-gradient(160deg, #241b07, #0f0f0f 70%, #000)",
  "linear-gradient(160deg, #2a1050, #120a24 70%, #000)",
  "linear-gradient(160deg, #07231b, #08140f 70%, #000)",
  "linear-gradient(160deg, #2a0f18, #14090d 70%, #000)",
];

const DEFAULTS: ThemeDraft = {
  bgType: "color",
  bgColor: "#0f0f0f",
  bgGradient: GRADIENTS[0]!,
  bgImage: "",
  accent: "#e4b34c",
};

function fromTheme(t?: PageTheme): ThemeDraft {
  return {
    bgType: t?.bgType ?? DEFAULTS.bgType,
    bgColor: t?.bgColor ?? DEFAULTS.bgColor,
    bgGradient: t?.bgGradient ?? DEFAULTS.bgGradient,
    bgImage: t?.bgImage ?? DEFAULTS.bgImage,
    accent: t?.accent ?? DEFAULTS.accent,
  };
}
function toTheme(d: ThemeDraft): PageTheme {
  return {
    bgType: d.bgType,
    bgColor: d.bgColor,
    bgGradient: d.bgGradient,
    bgImage: d.bgImage.trim() || undefined,
    accent: d.accent,
  };
}

export function RealmPageBuilder() {
  const channelQ = useMyChannel();
  const channel = channelQ.data;
  const configQ = useChannelConfig(channel?.id);
  const profileQ = useProfile(channel?.ownerAddress ?? null);
  const update = useUpdateConfig(channel?.id ?? "");

  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  useEffect(() => {
    if (configQ.data) setDraft(fromTheme(configQ.data.pageTheme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data?.version, configQ.data?.updatedAt]);

  if (channelQ.isLoading || configQ.isLoading || !draft) {
    if (!channelQ.isLoading && !channel) {
      return <EmptyState title="No realm yet" description="Create your realm to customize its page." />;
    }
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (!channel) return <EmptyState title="No realm yet" description="Create your realm to customize its page." />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/c/${channel.handle}`;
  const saved = fromTheme(configQ.data?.pageTheme);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<ThemeDraft>) => setDraft((d) => ({ ...(d as ThemeDraft), ...patch }));

  function save() {
    update.mutate(
      { pageTheme: toTheme(draft!) },
      {
        onSuccess: () => toast({ variant: "success", title: "Page saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: String(e) }),
      },
    );
  }

  const name = profileQ.data?.displayName?.trim() || `@${channel.handle}`;
  const description = configQ.data?.description?.trim();
  const links = profileQ.data?.links ?? [];

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
      {/* Controls */}
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-fg">My page</h2>
          <p className="text-small text-fg-muted">
            Customize how your public realm page looks. Changes apply to <code className="mono">/c/{channel.handle}</code>{" "}
            after you save.
          </p>
        </div>

        {/* My link */}
        <Section title="My link">
          <LinkRow url={link} />
        </Section>

        {/* Background */}
        <Section title="Background">
          <div className="flex gap-2">
            {(["color", "gradient", "image"] as BgType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set({ bgType: t })}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-small capitalize transition-colors",
                  draft.bgType === t
                    ? "border-border-strong bg-surface-raised text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {draft.bgType === "color" ? (
            <ColorField label="Background color" value={draft.bgColor} onChange={(v) => set({ bgColor: v })} />
          ) : null}

          {draft.bgType === "gradient" ? (
            <div className="grid grid-cols-4 gap-2">
              {GRADIENTS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => set({ bgGradient: g })}
                  aria-label="Gradient preset"
                  style={{ background: g }}
                  className={cn(
                    "h-14 rounded-md border-2 transition-colors",
                    draft.bgGradient === g ? "border-money" : "border-transparent hover:border-border-strong",
                  )}
                />
              ))}
            </div>
          ) : null}

          {draft.bgType === "image" ? (
            <Input
              label="Image URL"
              placeholder="https://… or data:image/…"
              value={draft.bgImage}
              onChange={(e) => set({ bgImage: e.target.value })}
              helper="Any image URL. It covers the card behind your content."
            />
          ) : null}
        </Section>

        {/* Accent */}
        <Section title="Accent color">
          <ColorField
            label="Buttons & highlights"
            value={draft.accent}
            onChange={(v) => set({ accent: v })}
          />
        </Section>

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <Button onClick={save} loading={update.isPending} disabled={!dirty}>
            Save page
          </Button>
          <Button variant="ghost" onClick={() => setDraft(saved)} disabled={!dirty}>
            Reset
          </Button>
        </div>
      </div>

      {/* Live preview */}
      <div className="lg:sticky lg:top-4">
        <div className="mx-auto w-full max-w-[320px]">
          <span className="mb-2 block text-caption uppercase tracking-wide text-fg-faint">Live preview</span>
          <div className="rounded-[2rem] border-[6px] border-surface-2 bg-black p-3 shadow-xl shadow-black/40">
            <div
              className="flex flex-col items-center gap-3 rounded-2xl border border-border p-4 text-fg"
              style={pageThemeStyle(toTheme(draft))}
            >
              <Monogram name={name} avatarUrl={profileQ.data?.avatarUrl} size="lg" />
              <div className="text-center">
                <div className="font-display text-lg font-semibold text-fg">{name}</div>
                {description ? <div className="text-caption text-fg-muted">{description}</div> : null}
              </div>

              <div className="flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-black/30 p-3 backdrop-blur-sm">
                <div className="rounded-md border border-border bg-black/40 px-3 py-2 text-small text-fg-faint">
                  Anonymous
                </div>
                <div className="rounded-md border border-border bg-black/40 px-3 py-2 text-small text-fg-faint">
                  Amount
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {["$5", "$10", "$25"].map((p) => (
                    <span
                      key={p}
                      className="rounded-md border border-border py-1 text-center text-caption text-fg-muted"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="mono rounded-md py-2 text-center text-small font-semibold"
                  style={{ background: draft.accent, color: "#0d0d0d" }}
                >
                  Send Crown
                </button>
              </div>

              {links.length > 0 ? (
                <div className="flex items-center gap-2">
                  {links.slice(0, 6).map((l) => {
                    const def = platformDef(l.platform);
                    if (!def) return null;
                    return (
                      <span key={l.platform} className="text-fg-muted" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                          <path d={def.iconPath} />
                        </svg>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <CrownLogo size={16} className="text-money/60" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-small font-medium text-fg">{title}</h3>
      {children}
    </div>
  );
}

function LinkRow({ url }: { url: string }) {
  const [copied, mark] = useCopied();
  return (
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
        aria-label="Copy link"
        className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-border px-3 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        {copied ? <CheckIcon className="h-4 w-4 text-status" /> : <CopyIcon className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Color swatch + hex text input, kept in sync. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-12 flex-none cursor-pointer rounded border border-border bg-surface"
      />
      <div className="flex-1">
        <Input label={label} mono value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
