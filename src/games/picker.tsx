"use client";

import type { ComponentType } from "react";
import { DonateWidget } from "@/components/domain/donate";
import { GiftIcon } from "@/components/ui/icons";
import type { Channel, ChannelConfig, Session, ViewerStanding } from "@/lib/data/types";
import { GAME_PANELS } from "./panels";
import { getGame } from "./registry";
import type { GameId } from "./types";

/**
 * Реестр «что зритель может запустить» для правого рейла (GameActionRail). Пикер и монтирование формы
 * рендерятся ИЗ этого массива: добавить игру = добавить запись в реестр игр (registry.ts + panels.tsx), UI
 * не переписывается. «Донат» — псевдо-игра (первая запись), переиспользует существующий DonateWidget; игры —
 * оборачивают существующий Rail. Формы НЕ переписываем, только монтируем с нужными пропсами через RailContext.
 */

/** Всё, что может понадобиться форме в рейле — прокидывается со страницы канала. */
export interface RailContext {
  channel: Channel;
  config: ChannelConfig;
  session: Session;
  standing?: ViewerStanding | null;
  standingLoading?: boolean;
  handle: string;
}

/** Запись пикера: как показать в списке (иконка/название/тизер/правила) + что смонтировать в рейле (форма). */
export interface PickerEntry {
  id: string;
  name: string;
  tagline: string;
  Icon: ComponentType<{ className?: string }>;
  // channelId — играм с параметрами канала (правила спора живут в канистре, M1/M2); донату не нужен.
  Rules: ComponentType<{ channelId?: string }>;
  Form: ComponentType<{ ctx: RailContext }>;
}

/** Правила обычного доната — в модалке «i». */
function DonateRules() {
  return (
    <div className="flex flex-col gap-3 text-small text-fg-muted">
      <p>
        Разовый донат стримеру: деньги уходят ему сразу и необратимо (минус 3% комиссии платформы), а
        ты копишь <span className="text-fg">репутацию</span> на этом канале.
      </p>
      <p>Сообщение к донату (по желанию) приватно, пока стример не покажет его в ленте.</p>
    </div>
  );
}

/** «Донат» — всегда первая запись (90% кейсов). Переиспользует существующий DonateWidget. */
const DONATE_ENTRY: PickerEntry = {
  id: "donate",
  name: "Донат",
  tagline: "Сразу стримеру, копит репутацию.",
  Icon: GiftIcon,
  Rules: DonateRules,
  Form: ({ ctx }) => (
    <DonateWidget
      channel={ctx.channel}
      config={ctx.config}
      session={ctx.session}
      standing={ctx.standing}
      standingLoading={ctx.standingLoading}
    />
  ),
};

/**
 * Записи пикера: «Донат» + включённые на канале игры (из реестра). Форма игры оборачивает СУЩЕСТВУЮЩИЙ Rail
 * (не переписываем). Результат стабилизируй через useMemo(enabledGames) на стороне рейла — иначе форма игры
 * будет ремонтироваться и терять ввод.
 */
export function pickerEntries(enabledGames: string[]): PickerEntry[] {
  const games = enabledGames
    .map((id): PickerEntry | null => {
      const game = getGame(id as GameId);
      const ui = GAME_PANELS[id as GameId];
      if (!game || !ui) return null;
      const Rail = ui.Rail;
      return {
        id,
        name: game.title,
        tagline: game.tagline,
        Icon: ui.Icon,
        Rules: ui.Rules,
        Form: ({ ctx }) => (
          <Rail
            channelId={ctx.channel.id}
            ownerAddress={ctx.channel.ownerAddress}
            handle={ctx.handle}
          />
        ),
      };
    })
    .filter((e): e is PickerEntry => e !== null);
  return [DONATE_ENTRY, ...games];
}
