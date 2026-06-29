"use client";

import { GAME_PANELS } from "./panels";
import { getGame } from "./registry";
import type { GameId } from "./types";
import { cn } from "@/lib/utils";

/**
 * Раздел мини-игр на канале (G1.5 / редизайн). ЛЕВО: карточки-выбор «что сделать» (обычный донат + игры) +
 * содержимое выбранного (для игры — Hub: правила + активные партии; для доната — короткое пояснение).
 * Правый рейл (действие выбранного) рендерит страница канала: `ChannelGameRail` для игры или донат-виджет.
 */
export const DONATE_OPTION = "donate";

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
  const games = enabledGames
    .map((id) => ({ id, game: getGame(id as GameId), ui: GAME_PANELS[id as GameId] }))
    .filter((x) => x.game && x.ui);

  // Карточки выбора: «Обычный донат» + игры. Что выбрано сейчас (по умолчанию приходит первая игра).
  const active = selectedGame ?? games[0]?.id ?? DONATE_OPTION;
  const onDonate = active === DONATE_OPTION;
  const selGame = games.find((x) => x.id === active) ?? null;
  const Hub = selGame?.ui?.Hub ?? null; // имя-компонент с заглавной — для использования как <Hub/>.

  const cards: { id: string; title: string; tagline: string }[] = [
    {
      id: DONATE_OPTION,
      title: "Обычный донат",
      tagline: "Разовый донат — сразу стримеру, копит твою репутацию.",
    },
    ...games.map((x) => ({ id: x.id, title: x.game!.title, tagline: x.game!.tagline })),
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Выбор «что сделать» карточками. Клик → правый рейл и содержимое слева меняются под выбор. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-pressed={c.id === active}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors",
              c.id === active
                ? "border-border-strong bg-surface-raised"
                : "border-border bg-surface hover:border-border-strong",
            )}
          >
            <span className="font-display text-fg">{c.title}</span>
            <span className="text-small text-fg-muted">{c.tagline}</span>
          </button>
        ))}
      </div>

      {onDonate || !Hub ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-h3 text-fg">Обычный донат</h3>
          <p className="text-small text-fg-muted">
            Разовый донат стримеру: деньги идут ему сразу и необратимо, а ты копишь репутацию на
            этом канале. Форма доната — справа.
          </p>
        </div>
      ) : (
        <Hub channelId={channelId} ownerAddress={ownerAddress} handle={handle} />
      )}
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
