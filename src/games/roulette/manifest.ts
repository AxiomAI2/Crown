import type { GameModule } from "../types";

/**
 * Manifest — "Reign Roulette" (mini-game, in development). A live spin that spotlights one supporter of the realm,
 * weighted by Reign — a status moment, NOT a wager: no one wins another supporter's money (golden invariants §4,
 * legal-and-risk §6). Status `building`: it shows in the catalog as "coming soon" and can't be enabled on a realm
 * yet (types.ts GameStatus). Full spec — TBD.
 */
export const roulette: GameModule = {
  id: "roulette",
  title: "Reign Roulette",
  tagline: "A live spin puts one supporter in the spotlight — weighted by Reign, never by chance alone.",
  status: "building",
  specDoc: "docs/yellow-paper.md",
};
