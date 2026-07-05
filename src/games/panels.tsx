import type { ComponentType } from "react";
import { EscrowTaskHub, EscrowTaskRail, EscrowTaskRules } from "./escrow-task/EscrowTaskPanel";
import type { GameId } from "./types";
import { TargetIcon } from "@/components/ui/icons";

/**
 * Реестр ЭКРАНОВ игр (UI), отдельно от data-манифеста (`registry.ts`). Каждая игра даёт поверхности:
 *  - Rail  — правый рейл страницы канала: действие (создать/играть);
 *  - Hub   — левая часть («Активные»): активные партии игры (мониторинг);
 *  - Rules — правила игры (в модалке «i» пикера игр, GameActionRail);
 *  - Icon  — иконка в пикере игр.
 * Раздел игр и пикер рендерят их, перебирая реестр. Добавить экран новой игры = одна строка.
 */
export interface GamePanelProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

export interface GameUI {
  Rail: ComponentType<GamePanelProps>;
  Hub: ComponentType<GamePanelProps>;
  Rules: ComponentType<{ channelId?: string }>;
  Icon: ComponentType<{ className?: string }>;
}

export const GAME_PANELS: Partial<Record<GameId, GameUI>> = {
  "escrow-task": { Rail: EscrowTaskRail, Hub: EscrowTaskHub, Rules: EscrowTaskRules, Icon: TargetIcon },
};
