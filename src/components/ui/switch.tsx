"use client";

import { cn } from "@/lib/utils";

/** Переключатель (role=switch) поверх кнопки — без доп. зависимостей. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors duration-fast ease-ease disabled:opacity-50",
          checked ? "border-info bg-info" : "border-border bg-surface-raised",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-pill bg-fg transition-transform duration-fast ease-ease",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
      {label ? <span className="text-small text-fg-muted">{label}</span> : null}
    </label>
  );
}
