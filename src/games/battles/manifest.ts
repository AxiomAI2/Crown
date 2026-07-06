import type { GameModule } from "../types";

/**
 * Manifest — "Crown Battles" (mini-game, in development). Two sides go head to head and their communities rally
 * crowns behind them; the outcome is a status moment, not a pot to win (golden invariants §4, legal-and-risk §6 —
 * we frame competition/community, never a bet). Status `building`: shows in the catalog as "coming soon" and can't
 * be enabled on a realm yet (types.ts GameStatus). Full spec — TBD.
 */
export const battles: GameModule = {
  id: "battles",
  title: "Crown Battles",
  tagline: "Two sides go head to head — supporters rally crowns behind theirs, and Reign decides the winner.",
  status: "building",
  specDoc: "docs/yellow-paper.md",
};
