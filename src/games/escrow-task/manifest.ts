import type { GameModule } from "../types";

/**
 * Manifest of the first mini-game — "task-for-a-crown with community verification". Full spec —
 * `yellow-paper §7`, the seam with the reputation core — ADR 0015. Status `available`:
 * a channel enables the game with a toggle in the studio (enabledGames).
 */
export const escrowTask: GameModule = {
  id: "escrow-task",
  title: "Tasks for a Crown",
  tagline: "Paid tasks: complete it or the money returns.",
  status: "available",
  specDoc: "docs/yellow-paper.md",
};
