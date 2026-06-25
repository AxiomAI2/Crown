"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { platformDef } from "@/lib/channel-links";
import type { ChannelLink, ChannelLinkPlatform } from "@/lib/data/types";

/** Логотип платформы (simple-icons, currentColor). Цвет задаётся снаружи через `color`/text-*. */
export function PlatformIcon({
  platform,
  className,
  brand,
}: {
  platform: ChannelLinkPlatform;
  className?: string;
  brand?: boolean; // true → фирменный цвет; иначе наследует currentColor
}) {
  const def = platformDef(platform);
  if (!def) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      style={brand ? { color: def.color } : undefined}
      aria-hidden="true"
    >
      <path d={def.iconPath} />
    </svg>
  );
}

/** Одна ссылка-«пилюля» с логотипом. Ведёт на каноничный профиль/канал, открывается в новой вкладке. */
function LinkPill({ link }: { link: ChannelLink }) {
  const def = platformDef(link.platform);
  if (!def) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={def.label}
      className="group inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
    >
      <PlatformIcon platform={link.platform} brand className="h-4 w-4 shrink-0" />
      <span>{def.label}</span>
    </a>
  );
}

/**
 * Ссылки канала/профиля кнопками с логотипами (не голые URL). Чтобы длинный список не растягивал блок (и
 * соседний по сетке), показываем максимум `max` ссылок в ряд, а остальные прячем за «…» — по клику
 * всплывает мини-окно (Dialog) со ВСЕМИ ссылками.
 */
export function ChannelLinkButtons({ links, max = 4 }: { links: ChannelLink[]; max?: number }) {
  const valid = links.filter((l) => platformDef(l.platform));
  if (!valid.length) return null;

  // Прячем за «…» только если скрытых ≥ 2 — иначе «…» занял бы то же место, что и одна ссылка.
  const collapse = valid.length > max + 1;
  const shown = collapse ? valid.slice(0, max) : valid;
  const hiddenCount = valid.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((l) => (
        <LinkPill key={l.url} link={l} />
      ))}
      {collapse ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              title={`Ещё ${hiddenCount} — показать все ссылки`}
              aria-label={`Ещё ${hiddenCount} ссылок — показать все`}
              className="inline-flex items-center rounded-pill border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              … +{hiddenCount}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ссылки</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              {valid.map((l) => (
                <LinkPill key={l.url} link={l} />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
