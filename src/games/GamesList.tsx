"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LockIcon } from "@/components/ui/icons";
import { GAME_PANELS } from "./panels";
import { GAMES } from "./registry";
import type { GameModule } from "./types";
import { cn } from "@/lib/utils";

/**
 * Mini-game catalog: poster cards in a grid (in a row, wrapping when space runs out). Each card is a
 * full-height cover (a placeholder for now: gradient by id hash + icon; later — a real game photo).
 * The title/description reveal ON HOVER. A click opens the rules (or "coming soon" for stubs).
 */
export function GamesList({ enabledGames }: { enabledGames: string[] }) {
  const [rulesFor, setRulesFor] = useState<GameModule | null>(null);
  const RulesComp = rulesFor ? GAME_PANELS[rulesFor.id]?.Rules : null;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {GAMES.map((game) => {
          const Icon = GAME_PANELS[game.id]?.Icon ?? LockIcon;
          const enabledHere = enabledGames.includes(game.id);
          const building = game.status === "building";
          const status = enabledHere
            ? { label: "Live", cls: "text-status" }
            : building
              ? { label: "Soon", cls: "text-fg-faint" }
              : { label: "Available", cls: "text-fg-muted" };
          return (
            <button
              key={game.id}
              type="button"
              onClick={() => setRulesFor(game)}
              aria-label={game.title}
              className="group relative block aspect-[3/4] overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-border-strong"
            >
              {/* Cover (placeholder): brand gradient (black + gold), NOT a per-id rainbow — the game icon is the
                  differentiator. Replace with a real <img> later. */}
              <span
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(155deg, var(--surface-2), var(--surface) 55%, #000)",
                }}
              />
              <span className="absolute inset-0 grid place-items-center text-status-dim">
                <Icon className="h-12 w-12 opacity-30 transition-opacity duration-200 group-hover:opacity-15" />
              </span>

              {/* Caption — reveals on hover */}
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black via-black/75 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-small font-semibold leading-tight text-fg">
                    {game.title}
                  </span>
                  <span className={cn("flex-none text-caption", status.cls)}>{status.label}</span>
                </div>
                <p className="line-clamp-3 text-caption normal-case tracking-normal text-fg-muted">
                  {game.tagline}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!rulesFor} onOpenChange={(o) => (o ? null : setRulesFor(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rulesFor?.title}</DialogTitle>
          </DialogHeader>
          {RulesComp ? (
            <RulesComp />
          ) : (
            <p className="text-small text-fg-muted">{rulesFor?.tagline} Coming soon.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
