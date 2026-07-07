/**
 * DARK BACKGROUND variants for a live test (dev, PaletteSwitcher). The gold accent is fixed — only the
 * base changes: --bg / --surface / --surface-2 (background, cards, overlays). Everything else (money/status/border/
 * text) is inherited from globals.css. Applied on the fly via root.style, without a rebuild.
 */
export interface Palette {
  id: string;
  name: string;
  dot: string; // swatch = the background shade (that's exactly what varies)
  vars: Record<string, string>;
}

/** Background variant: a base black/dark + two surface steps. */
function bg(base: string, surface: string, surface2: string): Record<string, string> {
  return { "--bg": base, "--surface": surface, "--surface-2": surface2 };
}

export const PALETTES: Palette[] = [
  // Slightly cool gray: a truly neutral gray reads warm/yellowish next to the gold accents.
  { id: "darkgray", name: "Dark gray (default)", dot: "#15171a", vars: bg("#15171a", "#1e2024", "#292b30") },
  { id: "black", name: "Pure black", dot: "#000000", vars: bg("#000000", "#0f0f0f", "#191919") },
  { id: "obsidian", name: "Obsidian (warm near-black)", dot: "#0a0806", vars: bg("#080706", "#12100c", "#1c1913") },
  { id: "charcoal", name: "Charcoal (neutral)", dot: "#0d0d0f", vars: bg("#0d0d0f", "#17171a", "#222228") },
  { id: "graphite", name: "Graphite (soft, lifted)", dot: "#101012", vars: bg("#101012", "#1a1a1f", "#26262c") },
  { id: "ink", name: "Ink (blue-black)", dot: "#05070e", vars: bg("#05070e", "#0d101a", "#161b28") },
  { id: "slate", name: "Slate (cool)", dot: "#0b0e13", vars: bg("#0b0e13", "#141822", "#1e2430") },
  { id: "espresso", name: "Espresso (brown-black)", dot: "#0b0806", vars: bg("#0b0806", "#15100b", "#201811") },
  { id: "plum", name: "Plum (purple-black)", dot: "#0a0710", vars: bg("#0a0710", "#14101d", "#1e1829") },
  { id: "wine", name: "Wine (red-black)", dot: "#0c0608", vars: bg("#0c0608", "#160d10", "#21151a") },
  { id: "forest", name: "Forest (green-black)", dot: "#060a08", vars: bg("#060a08", "#0f1512", "#19211c") },
];

export const DEFAULT_PALETTE_ID = "darkgray";

// The variables the test touches (to clear previous overrides on change).
const ALL_KEYS = Array.from(new Set(PALETTES.flatMap((p) => Object.keys(p.vars))));

/** Apply a background variant to :root (removes previous overrides, sets new ones). */
export function applyPalette(id: string): void {
  if (typeof document === "undefined") return;
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  if (!p) return;
  const root = document.documentElement;
  for (const key of ALL_KEYS) root.style.removeProperty(key);
  for (const [k, v] of Object.entries(p.vars)) root.style.setProperty(k, v);
}
