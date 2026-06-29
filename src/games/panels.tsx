import type { ComponentType } from "react";
import { EscrowTaskPanel } from "./escrow-task/EscrowTaskPanel";
import type { GameId } from "./types";

/**
 * Реестр ЭКРАНОВ игр (UI), отдельно от data-манифеста (`registry.ts`) — чтобы манифест оставался
 * данными-онли. Страница канала рендерит панель включённой игры отсюда. Добавить экран новой игры =
 * одна строка. Игра без панели здесь просто не показывает UI на канале.
 */
export interface GamePanelProps {
  channelId: string;
  ownerAddress: string;
  handle: string; // для ссылок на под-страницы игры (напр. страница спора)
}

export const GAME_PANELS: Partial<Record<GameId, ComponentType<GamePanelProps>>> = {
  "escrow-task": EscrowTaskPanel,
};
