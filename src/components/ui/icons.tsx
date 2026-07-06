/**
 * Minimal stroke icons (24×24, currentColor, no fill). Size is set via className (h-/w-).
 * No icon library — so we don't pull in a dependency for a couple of glyphs.
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

/** Magnifier — for search fields. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

/** Cross — clear/close. */
export function XIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Chevron right — pagination/"next". */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Chevron left — pagination/"back". */
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

/** Chevron down — expanding the select. */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Shield — moderation actions (hide/ban). */
export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** External link (open in a new tab) — e.g. a transaction in the explorer. */
export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/** Flag — complaint/report. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </svg>
  );
}

/** Copy (two overlapping cards) — copy an address/hash. */
export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Checkmark — success/copied. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

/** Pencil — edit. */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Eye — show. */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Crossed-out eye — hide. */
export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** Lock — "non-transferable". */
export function LockIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Crown — the top tier. */
export function CrownIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M3 7 7 11 12 5 17 11 21 7 19.5 19 4.5 19Z" />
    </svg>
  );
}

/** Three dots — the "more" menu. */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** "i" in a circle — rules/help. */
export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/** Gift — a regular crown. */
export function GiftIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M20 12v8H4v-8" />
      <path d="M2 8h20v4H2z" />
      <path d="M12 8v12" />
      <path d="M12 8S10.5 4 8 4a2 2 0 0 0 0 4h4Zm0 0s1.5-4 4-4a2 2 0 0 1 0 4h-4Z" />
    </svg>
  );
}

/** Target — the "task-for-a-crown" game. */
export function TargetIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Roulette wheel — the roulette mini-game. */
export function RouletteIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3.8M12 17.2V21M3 12h3.8M17.2 12H21M5.64 5.64l2.68 2.68M15.68 15.68l2.68 2.68M18.36 5.64l-2.68 2.68M8.32 15.68l-2.68 2.68" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Crossed swords — the battles mini-game. */
export function SwordsIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" y1="14" x2="9" y2="18" />
      <line x1="7" y1="17" x2="4" y2="20" />
    </svg>
  );
}
