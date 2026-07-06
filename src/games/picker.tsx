"use client";

import type { ComponentType } from "react";
import { DonateWidget } from "@/components/domain/donate";
import { GiftIcon } from "@/components/ui/icons";
import type { Channel, ChannelConfig, Session, ViewerStanding } from "@/lib/data/types";
import { GAME_PANELS } from "./panels";
import { getGame } from "./registry";
import type { GameId } from "./types";

/**
 * Registry of "what the viewer can launch" for the right rail (GameActionRail). The picker and the form mounting are
 * rendered FROM this array: adding a game = adding an entry to the game registry (registry.ts + panels.tsx), the UI is
 * not rewritten. "Crown" is a pseudo-game (the first entry), reusing the existing DonateWidget; games wrap the existing
 * Rail. We do NOT rewrite the forms, only mount them with the needed props via RailContext.
 */

/** Everything a rail form might need — passed down from the realm page. */
export interface RailContext {
  channel: Channel;
  config: ChannelConfig;
  session: Session;
  standing?: ViewerStanding | null;
  standingLoading?: boolean;
  handle: string;
}

/** A picker entry: how to show it in the list (icon/name/tagline/rules) + what to mount in the rail (the form). */
export interface PickerEntry {
  id: string;
  name: string;
  tagline: string;
  Icon: ComponentType<{ className?: string }>;
  // channelId — for games with channel params (dispute rules live in the canister, M1/M2); the crown doesn't need it.
  Rules: ComponentType<{ channelId?: string }>;
  Form: ComponentType<{ ctx: RailContext }>;
}

/** Rules for a regular crown — in the "i" modal. */
function DonateRules() {
  return (
    <div className="flex flex-col gap-3 text-small text-fg-muted">
      <p>
        A one-time crown to the streamer: the money goes to them immediately and irreversibly (minus the platform's
        3% fee), and you build up <span className="text-fg">Reign</span> in this realm.
      </p>
      <p>The message attached to the crown (optional) stays private until the content maker shows it in the feed.</p>
    </div>
  );
}

/** "Crown" — always the first entry (90% of cases). Reuses the existing DonateWidget. */
const DONATE_ENTRY: PickerEntry = {
  id: "donate",
  name: "Crown",
  tagline: "Straight to the content maker, builds Reign.",
  Icon: GiftIcon,
  Rules: DonateRules,
  Form: ({ ctx }) => (
    <DonateWidget
      channel={ctx.channel}
      config={ctx.config}
      session={ctx.session}
      standing={ctx.standing}
      standingLoading={ctx.standingLoading}
    />
  ),
};

/**
 * Picker entries: "Crown" + the games enabled in this realm (from the registry). A game's form wraps the EXISTING Rail
 * (we don't rewrite it). Stabilize the result via useMemo(enabledGames) on the rail side — otherwise the game's form
 * will remount and lose its input.
 */
export function pickerEntries(enabledGames: string[]): PickerEntry[] {
  const games = enabledGames
    .map((id): PickerEntry | null => {
      const game = getGame(id as GameId);
      const ui = GAME_PANELS[id as GameId];
      if (!game || !ui) return null;
      const Rail = ui.Rail;
      return {
        id,
        name: game.title,
        tagline: game.tagline,
        Icon: ui.Icon,
        Rules: ui.Rules,
        Form: ({ ctx }) => (
          <Rail
            channelId={ctx.channel.id}
            ownerAddress={ctx.channel.ownerAddress}
            handle={ctx.handle}
          />
        ),
      };
    })
    .filter((e): e is PickerEntry => e !== null);
  return [DONATE_ENTRY, ...games];
}
