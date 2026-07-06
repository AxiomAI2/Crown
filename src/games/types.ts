/**
 * The "games-as-modules" skeleton (ADR 0016). Each mini-game is a self-contained module in `src/games/<id>/`
 * that declares a manifest (`GameModule`) and registers itself in `registry.ts`. The core (`lib/`,
 * `components/domain/`, screens) does NOT know about specific games — it works with reputation and the ledger
 * (ADR 0015), while games plug in on top. Adding a new game = adding a folder + one line in the registry;
 * the core screens are untouched.
 *
 * The manifest is deliberately DATA-ONLY (no React/logic) — it can be imported anywhere (registry, docs,
 * realm settings). Slots for screens (a panel on the realm page / in the studio) will be added here too, once
 * the components themselves appear (G1), so as not to breed empty stubs.
 */

/** A game identifier. Extended by a union when a new game is added. */
export type GameId = "escrow-task" | "roulette" | "battles";

/**
 * Module readiness. `building` — the game is still being built: visible in docs/dev, but NOT offered to realms for
 * enabling. `available` — can be enabled in a realm.
 */
export type GameStatus = "building" | "available";

export interface GameModule {
  id: GameId;
  /** Name in the UI. */
  title: string;
  /** One line — what it is, for the card in the studio/discovery. */
  tagline: string;
  status: GameStatus;
  /** Path to the game's spec in the repo (for links from the UI/docs). */
  specDoc: string;
}
