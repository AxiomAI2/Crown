"use client";

import { getGame } from "./registry";
import { GAME_PANELS } from "./panels";
import type { GameId } from "./types";

/**
 * Сюрфейс мини-игр на странице канала (G1.5): рендерит панели игр, ВКЛЮЧЁННЫХ на канале, перебирая
 * реестр — без хардкода под конкретную игру. Новая игра с панелью появляется тут сама. Игры без панели
 * (или ещё не зарегистрированные) пропускаются.
 */
export function ChannelGames({
  channelId,
  ownerAddress,
  handle,
  enabledGames,
}: {
  channelId: string;
  ownerAddress: string;
  handle: string;
  enabledGames: string[];
}) {
  const items = enabledGames
    .map((id) => ({ id, game: getGame(id as GameId), Panel: GAME_PANELS[id as GameId] }))
    .filter(
      (
        x,
      ): x is {
        id: string;
        game: NonNullable<typeof x.game>;
        Panel: NonNullable<typeof x.Panel>;
      } => Boolean(x.game && x.Panel),
    );

  if (items.length === 0) {
    return (
      <p className="text-small rounded-lg border border-dashed border-border p-6 text-center text-fg-faint">
        На этом канале мини-игры не включены.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {items.map(({ id, game, Panel }) => (
        <section key={id} className="flex flex-col gap-3">
          <div className="text-caption uppercase tracking-wide text-fg-faint">{game.title}</div>
          <Panel channelId={channelId} ownerAddress={ownerAddress} handle={handle} />
        </section>
      ))}
    </div>
  );
}
