import type { ComponentType } from "react";
import { EscrowTaskHub, EscrowTaskRail } from "./escrow-task/EscrowTaskPanel";
import type { GameId } from "./types";

/**
 * Реестр ЭКРАНОВ игр (UI), отдельно от data-манифеста (`registry.ts`). Каждая игра даёт две поверхности:
 *  - Rail — правый рейл страницы канала: действие (создать/играть);
 *  - Hub  — левая часть: правила игры + активные партии (мониторинг).
 * Раздел игр на канале рендерит их, перебирая реестр. Добавить экран новой игры = одна строка.
 */
export interface GamePanelProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

export interface GameUI {
  Rail: ComponentType<GamePanelProps>;
  Hub: ComponentType<GamePanelProps>;
}

export const GAME_PANELS: Partial<Record<GameId, GameUI>> = {
  "escrow-task": { Rail: EscrowTaskRail, Hub: EscrowTaskHub },
};
