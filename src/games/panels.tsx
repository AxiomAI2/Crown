import type { ComponentType } from "react";
import { EscrowTaskHub, EscrowTaskRail, EscrowTaskRules } from "./escrow-task/EscrowTaskPanel";
import type { GameId } from "./types";
import { RouletteIcon, SwordsIcon, TargetIcon } from "@/components/ui/icons";

/**
 * Registry of game SCREENS (UI), separate from the data manifest (`registry.ts`). Each game provides surfaces:
 *  - Rail  — the realm page's right rail: the action (create/play);
 *  - Hub   — the left part ("Active"): the game's active rounds (monitoring);
 *  - Rules — the game's rules (in the "i" modal of the game picker, GameActionRail);
 *  - Icon  — the icon in the game picker.
 * The games section and the picker render them by iterating the registry. Adding a new game's screen = one line.
 */
export interface GamePanelProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

export interface GameUI {
  Rail: ComponentType<GamePanelProps>;
  Hub: ComponentType<GamePanelProps>;
  Rules: ComponentType<{ channelId?: string }>;
  Icon: ComponentType<{ className?: string }>;
}

export const GAME_PANELS: Partial<Record<GameId, GameUI>> = {
  "escrow-task": { Rail: EscrowTaskRail, Hub: EscrowTaskHub, Rules: EscrowTaskRules, Icon: TargetIcon },
};

/**
 * Catalog icons for games that aren't playable yet (`building`) — just the icon, so we don't breed empty
 * Rail/Hub/Rules stubs for a game that has no screens. Playable games take their icon from GAME_PANELS above;
 * the catalog (GamesList) falls back here, then to a padlock.
 */
export const GAME_ICONS: Partial<Record<GameId, ComponentType<{ className?: string }>>> = {
  roulette: RouletteIcon,
  battles: SwordsIcon,
};
