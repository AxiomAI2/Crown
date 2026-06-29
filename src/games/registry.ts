import { escrowTask } from "./escrow-task/manifest";
import type { GameId, GameModule } from "./types";

/**
 * Единственный список мини-игр платформы (ADR 0016). Добавить игру = добавить её манифест сюда. Сайт
 * (страница канала, студия) рендерит игры, ИТЕРИРУЯ этот реестр, а не хардкодя каждую — новая игра
 * появляется в UI автоматически.
 */
export const GAMES: readonly GameModule[] = [escrowTask];

export function getGame(id: GameId): GameModule | undefined {
  return GAMES.find((g) => g.id === id);
}

/** Игры, доступные каналам к включению (модули в статусе `building` скрыты вне дева). */
export function availableGames(): GameModule[] {
  return GAMES.filter((g) => g.status === "available");
}
