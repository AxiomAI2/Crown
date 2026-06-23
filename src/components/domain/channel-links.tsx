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

/**
 * Ссылки канала кнопками с логотипами (не голые URL). Ведут на каноничный профиль/канал (валидация при
 * сохранении, см. lib/channel-links). Внешние ссылки — rel=noopener noreferrer, открываются в новой вкладке.
 */
export function ChannelLinkButtons({ links }: { links: ChannelLink[] }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((l) => {
        const def = platformDef(l.platform);
        if (!def) return null;
        return (
          <a
            key={l.platform}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={def.label}
            className="group inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <PlatformIcon platform={l.platform} brand className="h-4 w-4 shrink-0" />
            <span>{def.label}</span>
          </a>
        );
      })}
    </div>
  );
}
