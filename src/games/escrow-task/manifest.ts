import type { GameModule } from "../types";

/**
 * Manifest of the first mini-game — "task-for-a-crown with community verification". Full spec —
 * `yellow-paper §7`, the seam with the reputation core — ADR 0015. Status `available`:
 * a channel enables the game with a toggle in the studio (enabledGames).
 */
export const escrowTask: GameModule = {
  id: "escrow-task",
  title: "Tasks for a Crown",
  tagline:
    "A crown with a task in escrow: the content maker completes it, the community verifies, otherwise — a refund to the donor.",
  status: "available",
  specDoc: "docs/yellow-paper.md",
};
