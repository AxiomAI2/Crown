"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { curvePoints } from "@/lib/reputation";
import { formatPoints, toMicro } from "@/lib/utils";
import type { Curve, ReputationConfig, Tier } from "@/lib/data/types";

/** Редактор формулы репутации: кривая + параметры + decay + живое превью + предупреждение о банкинге. */
export function ReputationFormulaEditor({
  value,
  onChange,
}: {
  value: ReputationConfig;
  onChange: (next: ReputationConfig) => void;
}) {
  const curve = value.curve;
  const setCurve = (c: Curve) => onChange({ ...value, curve: c });

  function setKind(kind: Curve["kind"]) {
    if (kind === curve.kind) return;
    if (kind === "linear") setCurve({ kind: "linear", pointsPerUSDC: 100 });
    else if (kind === "sublinear") setCurve({ kind: "sublinear", alpha: 0.8 });
    else
      setCurve({
        kind: "bracket",
        brackets: [
          { upToUSDC: 50, rate: 100 },
          { upToUSDC: null, rate: 30 },
        ],
      });
  }

  const preview = [10, 100, 1000].map((u) => ({
    u,
    p: Math.round(curvePoints(toMicro(u), curve)),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Кривая начисления"
        value={curve.kind}
        onChange={(e) => setKind(e.target.value as Curve["kind"])}
      >
        <option value="linear">Линейная (очки ∝ сумме)</option>
        <option value="sublinear">Сублинейная (amount^α)</option>
        <option value="bracket">Брэкеты (анти-плутократия)</option>
      </Select>

      {curve.kind === "linear" ? (
        <Input
          label="Очков за 1 USDC"
          mono
          inputMode="numeric"
          value={String(curve.pointsPerUSDC)}
          onChange={(e) => setCurve({ kind: "linear", pointsPerUSDC: Number(e.target.value) || 0 })}
        />
      ) : null}

      {curve.kind === "sublinear" ? (
        <Input
          label="Показатель α (0..1)"
          mono
          inputMode="decimal"
          value={String(curve.alpha)}
          onChange={(e) => setCurve({ kind: "sublinear", alpha: Number(e.target.value) || 0 })}
        />
      ) : null}

      {curve.kind === "bracket" ? (
        <BracketEditor brackets={curve.brackets} onChange={(brackets) => setCurve({ kind: "bracket", brackets })} />
      ) : null}

      <div className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
        <Switch
          checked={value.decay.enabled}
          onCheckedChange={(on) =>
            onChange({
              ...value,
              decay: on ? { enabled: true, halfLifeDays: value.decay.halfLifeDays ?? 90 } : { enabled: false },
            })
          }
          label="Decay (затухание репутации со временем)"
        />
        {value.decay.enabled ? (
          <Input
            label="Полураспад, дней"
            mono
            inputMode="numeric"
            value={String(value.decay.halfLifeDays ?? 90)}
            onChange={(e) =>
              onChange({ ...value, decay: { enabled: true, halfLifeDays: Number(e.target.value) || 1 } })
            }
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1 rounded border border-border bg-surface p-3">
        <span className="text-caption">Живое превью</span>
        {preview.map((row) => (
          <div key={row.u} className="mono flex items-center justify-between text-small text-fg">
            <span>${row.u}</span>
            <span className="text-status">{formatPoints(row.p)} очков</span>
          </div>
        ))}
      </div>

      <p className="rounded border border-warn bg-status-bg p-3 text-small text-fg-muted">
        Смена формулы не пересчитывает прошлые донаты — только будущие (банкинг). Это защита статуса от
        рагпулла; изменение поднимет версию конфига.
      </p>
    </div>
  );
}

function BracketEditor({
  brackets,
  onChange,
}: {
  brackets: { upToUSDC: number | null; rate: number }[];
  onChange: (b: { upToUSDC: number | null; rate: number }[]) => void;
}) {
  const update = (i: number, patch: Partial<{ upToUSDC: number | null; rate: number }>) =>
    onChange(brackets.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption">Ступени (маргинальные ставки, как налог)</span>
      {brackets.map((b, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input
            label="До $ (пусто = и выше)"
            mono
            value={b.upToUSDC === null ? "" : String(b.upToUSDC)}
            onChange={(e) =>
              update(i, { upToUSDC: e.target.value === "" ? null : Number(e.target.value) || 0 })
            }
          />
          <Input
            label="Очков за $"
            mono
            value={String(b.rate)}
            onChange={(e) => update(i, { rate: Number(e.target.value) || 0 })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(brackets.filter((_, idx) => idx !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...brackets, { upToUSDC: null, rate: 10 }])}
      >
        + ступень
      </Button>
    </div>
  );
}

/** Редактор тиров: имя, порог, цвет. Бейдж/перки сохраняются как есть. */
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
            label="Порог"
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
