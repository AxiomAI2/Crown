"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  /** Моноширинный режим для сумм/адресов (design-system.md §3). */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helper, error, mono, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={inputId} className="text-small text-fg-muted">
            {label}
          </label>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cn(
            "h-10 rounded border border-border bg-surface px-3 text-body text-fg placeholder:text-fg-faint",
            "transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-info",
            mono && "mono tabular-nums",
            error && "border-danger",
            className,
          )}
          {...props}
        />
        {error ? (
          <span className="text-small text-danger">{error}</span>
        ) : helper ? (
          <span className="text-small text-fg-faint">{helper}</span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
