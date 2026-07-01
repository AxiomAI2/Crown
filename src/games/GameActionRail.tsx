"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRightIcon, InfoIcon } from "@/components/ui/icons";
import { pickerEntries, type PickerEntry, type RailContext } from "./picker";

/**
 * Правый рейл действия зрителя (редизайн выбора игр). По умолчанию — форма обычного доната (90% кейсов).
 * Сверху компактная кнопка «другие игры» → список игр из реестра (иконка + название + тизер + «i» правила).
 * Выбор игры → форма этой игры + стрелка «назад» к списку. «i» → модалка с правилами игры.
 *
 * Денежные потоки/формы НЕ трогаются — тут только обёртка выбора: монтируем существующие формы из реестра.
 */
export function GameActionRail({
  channel,
  config,
  session,
  standing,
  standingLoading,
  handle,
  enabledGames,
}: RailContext & { enabledGames: string[] }) {
  // Мемо по enabledGames: стабильные идентичности записей → форма игры не ремонтируется (не теряет ввод).
  const entries = useMemo(() => pickerEntries(enabledGames), [enabledGames]);
  const [currentId, setCurrentId] = useState("donate");
  const [picking, setPicking] = useState(false);
  const [rulesFor, setRulesFor] = useState<PickerEntry | null>(null);

  const current = entries.find((e) => e.id === currentId) ?? entries[0];
  if (!current) return null; // недостижимо: «Донат» всегда в списке — но сужаем тип для TS
  const ctx: RailContext = { channel, config, session, standing, standingLoading, handle };

  return (
    <div className="flex flex-col gap-3">
      {picking ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <span className="text-caption uppercase tracking-wide text-fg-faint">Что сделать</span>
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-1 rounded-lg border border-border bg-[var(--bg)] transition-colors hover:border-border-strong"
            >
              <button
                type="button"
                onClick={() => {
                  setCurrentId(e.id);
                  setPicking(false);
                }}
                aria-pressed={e.id === current.id}
                className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
              >
                <e.Icon className="h-5 w-5 shrink-0 text-fg-muted" />
                <span className="min-w-0 truncate text-small text-fg">{e.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setRulesFor(e)}
                className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                aria-label={`Правила: ${e.name}`}
                title="Правила"
              >
                <InfoIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        // «другие игры» — в правом верхнем углу карточки, на строке «Мой standing» (по макету). Абсолютно,
        // чтобы не трогать форму/StandingHeadline; right/top-4 = совпадает с p-4 карточки; бейдж тира ниже
        // (на строке очков) — не конфликтует. Клик → список игр.
        <div className="relative">
          <current.Form ctx={ctx} />
          {/* «другие игры» — только для подключённого кошелька: без входа форма показывает «Подключи кошелёк»,
              и кнопка выбора игр там лишняя (накладывалась на заголовок). */}
          {session.address ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="absolute right-4 top-4 z-10 flex items-center gap-0.5 text-[11px] leading-none text-fg-muted transition-colors hover:text-fg"
            >
              другие игры
              <ChevronRightIcon className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      )}

      <Dialog open={!!rulesFor} onOpenChange={(o) => (o ? null : setRulesFor(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rulesFor?.name}</DialogTitle>
          </DialogHeader>
          {rulesFor ? <rulesFor.Rules /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
