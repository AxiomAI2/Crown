"use client";

import { cn } from "@/lib/utils";

/** A toggle (role=switch) built on top of a button — no extra dependencies. On-state is gold (brand accent);
 *  the knob darkens on gold for contrast. Pass `srLabel` when there is no visible `label` next to the switch. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  srLabel,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  /** Accessible name when the visible label lives elsewhere in the row. */
  srLabel?: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : srLabel}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors duration-fast ease-ease disabled:opacity-50",
          checked ? "border-money bg-money" : "border-border bg-surface-raised",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-pill transition-transform duration-fast ease-ease",
            checked ? "translate-x-5 bg-[#1a1206]" : "translate-x-1 bg-fg",
          )}
        />
      </button>
      {label ? <span className="text-small text-fg-muted">{label}</span> : null}
    </label>
  );
}
