/**
 * Минималистичные stroke-иконки (24×24, currentColor, без заливки). Размер задаётся через className (h-/w-).
 * Без иконочной библиотеки — чтобы не тащить зависимость ради пары глифов.
 */
type IconProps = { className?: string };

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Лупа — для поисковых полей. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

/** Крестик — очистить/закрыть. */
export function XIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Шеврон вправо — пагинация/«вперёд». */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Шеврон влево — пагинация/«назад». */
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

/** Щит — действия модерации (скрыть/бан). */
export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
