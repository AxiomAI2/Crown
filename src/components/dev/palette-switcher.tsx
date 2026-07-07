"use client";

import { useEffect, useState } from "react";
import { applyPalette, DEFAULT_PALETTE_ID, PALETTES } from "@/lib/palettes";
import { cn } from "@/lib/utils";

// v2: key bumped when the default moved to dark gray — an old saved "black" would silently keep
// overriding the new default at startup.
const STORAGE_KEY = "crown-palette-2";

/**
 * Dev tool: live cycling through the site's color palettes. Floating 🎨 button → list; clicking a palette
 * instantly recolors the whole site (overrides CSS variables), and the choice is saved to localStorage.
 * Mounts only outside production.
 */
export function PaletteSwitcher() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(DEFAULT_PALETTE_ID);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_PALETTE_ID;
    setActive(saved);
    applyPalette(saved);
  }, []);

  function choose(id: string) {
    setActive(id);
    applyPalette(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2">
      {open ? (
        <div className="w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/50">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Background · dev</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-caption text-fg-faint transition-colors hover:text-fg"
            >
              ✕
            </button>
          </div>
          <div className="flex max-h-[65vh] flex-col gap-0.5 overflow-y-auto p-1">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-small transition-colors",
                  active === p.id ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span
                  className="h-4 w-4 flex-none rounded-full ring-1 ring-inset ring-white/15"
                  style={{ background: p.dot }}
                />
                <span className="flex-1 truncate text-left">{p.name}</span>
                {active === p.id ? <span className="text-money">✓</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Theme palette (dev)"
        title="Theme palette (dev)"
        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-base shadow-lg shadow-black/40 transition-colors hover:border-border-strong"
      >
        🎨
      </button>
    </div>
  );
}
