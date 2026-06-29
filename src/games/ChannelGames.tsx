"use client";

import { GAME_PANELS } from "./panels";
import { getGame } from "./registry";
import type { GameId } from "./types";
import { cn } from "@/lib/utils";

/**
 * Раздел мини-игр на канале (G1.5 / редизайн). ЛЕВО: карточки-выбор игры + Hub выбранной (правила +
 * активные партии). Рендерим, перебирая реестр — без хардкода под конкретную игру; новая игра появляется
 * тут сама. Правый рейл (действие выбранной игры) рендерит `ChannelGameRail` со страницы канала.
 */
export function ChannelGames({
  channelId,
  ownerAddress,
  handle,
  enabledGames,
  selectedGame,
  onSelect,
}: {
  channelId: string;
  ownerAddress: string;
  handle: string;
  enabledGames: string[];
  selectedGame: string | null;
  onSelect: (id: string) => void;
}) {
  const items = enabledGames
    .map((id) => ({ id, game: getGame(id as GameId), ui: GAME_PANELS[id as GameId] }))
    .filter((x) => x.game && x.ui);

  if (items.length === 0) {
    return (
      <p className="text-small rounded-lg border border-dashed border-border p-6 text-center text-fg-faint">
        На этом канале мини-игры не включены.
      </p>
    );
  }

  const sel = items.find((x) => x.id === selectedGame) ?? items[0]!;
  const Hub = sel.ui!.Hub;

  return (
    <div className="flex flex-col gap-6">
      {/* Выбор игры карточками. Клик по карточке выбирает игру → правый рейл и Hub меняются под неё.
          Структура под несколько игр; сейчас одна — показываем одну карточку (она же выбрана). */}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(({ id, game }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={id === sel.id}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors",
              id === sel.id
                ? "border-border-strong bg-surface-raised"
                : "border-border bg-surface hover:border-border-strong",
            )}
          >
            <span className="font-display text-fg">{game!.title}</span>
            <span className="text-small text-fg-muted">{game!.tagline}</span>
          </button>
        ))}
      </div>

      <Hub channelId={channelId} ownerAddress={ownerAddress} handle={handle} />
    </div>
  );
}

/** Правый рейл: действие выбранной игры (например, форма создания задания-доната). */
export function ChannelGameRail({
  gameId,
  channelId,
  ownerAddress,
  handle,
}: {
  gameId: string;
  channelId: string;
  ownerAddress: string;
  handle: string;
}) {
  const ui = GAME_PANELS[gameId as GameId];
  if (!ui) return null;
  const Rail = ui.Rail;
  return <Rail channelId={channelId} ownerAddress={ownerAddress} handle={handle} />;
}
