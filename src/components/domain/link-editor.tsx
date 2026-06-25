"use client";

import { PlatformIcon } from "./channel-links";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CHANNEL_PLATFORMS,
  MAX_CHANNEL_LINKS,
  normalizeChannelLink,
  platformDef,
} from "@/lib/channel-links";
import type { ChannelLink, ChannelLinkPlatform } from "@/lib/data/types";

/** Одна строка ввода: платформа + сырой URL/ник. Список (не Record) → можно несколько ссылок на платформу. */
export type LinkInputRow = { platform: ChannelLinkPlatform; url: string };
export type LinkInputs = LinkInputRow[];

const FALLBACK_PLATFORM: ChannelLinkPlatform = CHANNEL_PLATFORMS[0]!.key;

/** Строки ввода → каноничные ссылки (пустые/невалидные отброшены, точные дубли убраны, не больше лимита). */
export function linksFromInputs(inputs: LinkInputs): ChannelLink[] {
  const out: ChannelLink[] = [];
  const seen = new Set<string>();
  for (const row of inputs) {
    const url = normalizeChannelLink(row.platform, row.url.trim());
    if (!url) continue;
    const key = `${row.platform}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform: row.platform, url });
    if (out.length >= MAX_CHANNEL_LINKS) break;
  }
  return out;
}

/** Существующие ссылки → строки ввода (порядок сохраняется). */
export function inputsFromLinks(links: ChannelLink[] | undefined): LinkInputs {
  return (links ?? []).map((l) => ({ platform: l.platform, url: l.url }));
}

/**
 * Редактор ссылок на внешние платформы (allowlist + инлайн-валидация). Вместо статичного списка всех
 * платформ — «добавляй по мере надобности»: строка = выбор платформы + поле ссылки + удалить, плюс кнопка
 * «+ Добавить ссылку» до потолка. Можно несколько ссылок на одно приложение. Общий для профиля и канала.
 */
export function LinkEditor({
  value,
  onChange,
}: {
  value: LinkInputs;
  onChange: (v: LinkInputs) => void;
}) {
  const atMax = value.length >= MAX_CHANNEL_LINKS;
  const setRow = (i: number, patch: Partial<LinkInputRow>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const addRow = () => {
    if (!atMax) onChange([...value, { platform: FALLBACK_PLATFORM, url: "" }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => {
        const def = platformDef(row.platform);
        const invalid = row.url.trim().length > 0 && !normalizeChannelLink(row.platform, row.url);
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={row.platform} brand className="h-5 w-5 shrink-0" />
              <div className="w-32 shrink-0">
                <Select
                  className="w-full"
                  value={row.platform}
                  aria-label="Платформа"
                  onChange={(e) => setRow(i, { platform: e.target.value as ChannelLinkPlatform })}
                >
                  {CHANNEL_PLATFORMS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  mono
                  placeholder={def?.example}
                  value={row.url}
                  aria-label={`Ссылка ${def?.label ?? ""}`}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setRow(i, { url: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Удалить ссылку"
                aria-label="Удалить ссылку"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface hover:text-fg"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            {invalid ? (
              <span className="pl-7 text-small text-danger">
                Нужна ссылка на профиль/канал в {def?.label} (напр. {def?.example}).
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={addRow} disabled={atMax}>
          + Добавить ссылку
        </Button>
        <span className="mono text-small text-fg-faint">
          {value.length}/{MAX_CHANNEL_LINKS}
        </span>
      </div>

      <p className="text-small text-fg-faint">
        Можно без https://. Принимается только ссылка на профиль/канал (не youtube.com/watch). Несколько
        ссылок на одно приложение — можно.
      </p>
    </div>
  );
}
