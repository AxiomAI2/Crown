"use client";

import { useState } from "react";
import { ChannelSettingsEditor } from "@/components/domain/channel-settings-editor";
import { RealmPageBuilder } from "@/components/domain/realm-page-builder";
import { cn } from "@/lib/utils";

/**
 * Customization tab — a container of sub-sections. First is the public-page builder ("Page"); the deep realm
 * settings (payout, tiers, minimums, moderators) live under "Settings". More sub-sections can be added here.
 */
const SUBTABS = [
  { key: "page", label: "Page" },
  { key: "settings", label: "Settings" },
] as const;
type SubTab = (typeof SUBTABS)[number]["key"];

export function CustomizationTab() {
  const [tab, setTab] = useState<SubTab>("page");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-display-l text-fg">Customization</h1>

      <div className="flex gap-1 border-b border-border">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "relative px-3 py-2 text-small transition-colors",
              tab === t.key ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {tab === t.key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-money" /> : null}
          </button>
        ))}
      </div>

      {tab === "page" ? <RealmPageBuilder /> : null}
      {tab === "settings" ? <ChannelSettingsEditor title="Realm settings" /> : null}
    </div>
  );
}
