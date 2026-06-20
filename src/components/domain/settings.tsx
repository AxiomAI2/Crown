"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tier } from "@/lib/data/types";

/**
 * Редактор тиров/порогов. Курс репутации фиксирован (1 USDC = 100 очков, ADR 0007) — здесь стример
 * задаёт ПОРОГИ в очках: сколько нужно для тира/перков/участия в мини-играх. Имя, порог, цвет.
 */
export function TierEditor({ value, onChange }: { value: Tier[]; onChange: (t: Tier[]) => void }) {
  const update = (i: number, patch: Partial<Tier>) =>
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  let ascending = true;
  for (let i = 1; i < value.length; i++) {
    const prev = value[i - 1];
    const cur = value[i];
    if (prev && cur && cur.threshold <= prev.threshold) ascending = false;
  }

  function add() {
    const lastThreshold = value.length > 0 ? (value[value.length - 1]?.threshold ?? 0) : 0;
    onChange([
      ...value,
      { name: "Новый тир", threshold: lastThreshold + 1000, color: "#9AA1B2", badge: "custom", perks: [] },
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input label="Имя" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
          <Input
            label="Порог, очков"
            mono
            value={String(t.threshold)}
            onChange={(e) => update(i, { threshold: Number(e.target.value) || 0 })}
          />
          <input
            type="color"
            aria-label="Цвет"
            value={t.color}
            onChange={(e) => update(i, { color: e.target.value })}
            className="h-10 w-12 rounded border border-border bg-surface"
          />
          <Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add}>
        + тир
      </Button>
      {!ascending ? (
        <p className="text-small text-warn">Пороги тиров должны идти по возрастанию.</p>
      ) : null}
    </div>
  );
}
