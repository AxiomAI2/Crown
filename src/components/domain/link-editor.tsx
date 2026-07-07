"use client";

import { PlatformIcon } from "./channel-links";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CHANNEL_PLATFORMS,
  MAX_CHANNEL_LINKS,
  normalizeChannelLink,
  platformDef,
} from "@/lib/channel-links";
import type { ChannelLink, ChannelLinkPlatform } from "@/lib/data/types";

/** A single input row: platform + raw URL/handle. A list (not a Record) → multiple links per platform are allowed. */
export type LinkInputRow = { platform: ChannelLinkPlatform; url: string };
export type LinkInputs = LinkInputRow[];

const FALLBACK_PLATFORM: ChannelLinkPlatform = CHANNEL_PLATFORMS[0]!.key;

/** Input rows → canonical links (empty/invalid dropped, exact duplicates removed, no more than the limit). */
export function linksFromInputs(inputs: LinkInputs): ChannelLink[] {
  const out: ChannelLink[] = [];
  const seen = new Set<string>();
  for (const row of inputs) {
    const url = normalizeChannelLink(row.platform, row.url.trim());
    if (!url) continue;
    const key = `${row.platform}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform: row.platform, url });
    if (out.length >= MAX_CHANNEL_LINKS) break;
  }
  return out;
}

/** Existing links → input rows (order preserved). */
export function inputsFromLinks(links: ChannelLink[] | undefined): LinkInputs {
  return (links ?? []).map((l) => ({ platform: l.platform, url: l.url }));
}

/**
 * Editor for links to external platforms (allowlist + inline validation). Instead of a static list of all
 * platforms — "add as needed": a row = platform picker + link field + remove, plus a
 * "+ Add link" button up to the cap. Multiple links to a single app are allowed. Shared by profile and realm.
 */
export function LinkEditor({
  value,
  onChange,
  size = "md",
}: {
  value: LinkInputs;
  onChange: (v: LinkInputs) => void;
  /** "lg" — roomier rows for pages where the links are the main content (create-realm Socials step). */
  size?: "md" | "lg";
}) {
  const lg = size === "lg";
  const atMax = value.length >= MAX_CHANNEL_LINKS;
  const setRow = (i: number, patch: Partial<LinkInputRow>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const addRow = () => {
    if (!atMax) onChange([...value, { platform: FALLBACK_PLATFORM, url: "" }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => {
        const def = platformDef(row.platform);
        const invalid = row.url.trim().length > 0 && !normalizeChannelLink(row.platform, row.url);
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className={lg ? "flex items-center gap-3" : "flex items-center gap-2"}>
              <PlatformIcon platform={row.platform} brand className={lg ? "h-6 w-6 shrink-0" : "h-5 w-5 shrink-0"} />
              <div className={lg ? "w-44 shrink-0" : "w-32 shrink-0"}>
                <Select
                  className="w-full"
                  value={row.platform}
                  aria-label="Platform"
                  onChange={(e) => setRow(i, { platform: e.target.value as ChannelLinkPlatform })}
                >
                  {CHANNEL_PLATFORMS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  mono
                  placeholder={def?.example}
                  value={row.url}
                  aria-label={`${def?.label ?? ""} link`}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setRow(i, { url: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Remove link"
                aria-label="Remove link"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            {invalid ? (
              <span className="pl-7 text-small text-danger">
                A link to your {def?.label} profile/channel is required (e.g. {def?.example}).
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" size={lg ? "md" : "sm"} onClick={addRow} disabled={atMax}>
          + Add link
        </Button>
        <span className="mono text-small text-fg-faint">
          {value.length}/{MAX_CHANNEL_LINKS}
        </span>
      </div>
    </div>
  );
}
