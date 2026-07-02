"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { GAMES } from "@/games/registry";
import type { GameModule } from "@/games/types";
import { useChannelConfig, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";

/**
 * Студия → «Мини-игры». Список рендерится ИЗ РЕЕСТРА (`src/games`, ADR 0016), а не хардкодом — новая игра
 * появляется тут сама. Включение хранится в конфиге канала (`enabledGames`). Игры в статусе `building`
 * показываются честно, но включить их нельзя (тумблер выключен) — никаких фейковых кнопок.
 */
export default function StudioGamesPage() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const configQ = useChannelConfig(channelId);
  const config = configQ.data;
  const update = useUpdateConfig(channelId ?? "");

  // Пороги репутации (задания/споры) — локальный черновик + явное «Сохранить» (не дёргаем сеть на каждый
  // ввод). Синхронизируем из конфига, когда он подгрузился/поменялся. Хуки — до ранних return (правила хуков).
  const cfgRepTask = config?.minReputationToTask ?? 0;
  const cfgRepDispute = config?.minReputationToDispute ?? 0;
  const [repTask, setRepTask] = useState(0);
  const [repDispute, setRepDispute] = useState(0);
  useEffect(() => {
    setRepTask(cfgRepTask);
    setRepDispute(cfgRepDispute);
  }, [cfgRepTask, cfgRepDispute]);

  if (myChannelQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!channelId) {
    return (
      <EmptyState
        title="Сначала создай канал"
        description="Мини-игры подключаются на канале — создай его в обзоре, потом включай механики здесь."
      />
    );
  }
  if (configQ.isLoading || !config) {
    if (configQ.error) {
      return (
        <ErrorState description="Не удалось загрузить конфиг." onRetry={() => configQ.refetch()} />
      );
    }
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  const enabled = new Set(config.enabledGames);

  function toggle(g: GameModule, on: boolean) {
    const next = on ? [...new Set([...enabled, g.id])] : [...enabled].filter((id) => id !== g.id);
    update.mutate(
      { enabledGames: next },
      {
        onSuccess: () =>
          toast({
            variant: "success",
            title: on ? `«${g.title}» включена` : `«${g.title}» выключена`,
          }),
        onError: (e) =>
          toast({ variant: "error", title: "Не удалось сохранить", description: String(e) }),
      },
    );
  }

  const thresholdsDirty = repTask !== cfgRepTask || repDispute !== cfgRepDispute;

  function saveThresholds() {
    update.mutate(
      { minReputationToTask: repTask, minReputationToDispute: repDispute },
      {
        onSuccess: () => toast({ variant: "success", title: "Пороги сохранены" }),
        onError: (e) =>
          toast({ variant: "error", title: "Не удалось сохранить", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Настройки мини-игр</h1>
        <p className="text-fg-muted">
          Механики поверх репутации. Включай, когда комьюнити набрало вес — на холодном канале в
          игры со спорами играть не с кем (cold-start).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {GAMES.map((g) => {
          const building = g.status === "building";
          const isOn = enabled.has(g.id);
          return (
            <div
              key={g.id}
              className="flex items-start gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-fg">{g.title}</span>
                  {building ? (
                    <span className="text-caption rounded-pill border border-border px-2 py-0.5 text-fg-faint">
                      в разработке
                    </span>
                  ) : null}
                </div>
                <p className="text-small text-fg-muted">{g.tagline}</p>
                {building ? (
                  <p className="text-small text-fg-faint">
                    Можно будет включить, когда игра готова.
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 pt-0.5">
                <Switch
                  checked={isOn}
                  disabled={building || update.isPending}
                  onCheckedChange={(on) => toggle(g, on)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Пороги репутации для «задание-донат» — рычаги стримера (§10): кто может присылать задания и
          поднимать споры. Репутация набирается донатами, так что порог = денежный барьер против нулевых
          кошельков (флуд заданий, спам споров). */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-fg">Пороги репутации</h2>
          <p className="text-small text-fg-muted">
            Репутация набирается донатами. Пороги отсекают нулевые кошельки: чтобы прислать задание
            или поднять спор, нужен статус — то есть реально поддержанный канал. 0 — без порога.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Мин. репутация для задания, очков"
            mono
            value={String(repTask)}
            onChange={(e) => setRepTask(Math.max(0, Number(e.target.value) || 0))}
          />
          <Input
            label="Порог репутации для спора, очков"
            mono
            value={String(repDispute)}
            onChange={(e) => setRepDispute(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <p className="text-small text-fg-faint">
          Высокий порог спора = меньше троллинга, но и меньше возможности оспорить. Совсем большой
          порог фактически отключает споры на канале — доноры это увидят.
        </p>
        <div>
          <Button
            variant="secondary"
            disabled={!thresholdsDirty || update.isPending}
            onClick={saveThresholds}
          >
            Сохранить пороги
          </Button>
        </div>
      </div>
    </div>
  );
}
