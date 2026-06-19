"use client";

import { forwardRef, useId, useState } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
  /** Показывать счётчик символов (нужен maxLength). */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, label, helper, error, showCount, maxLength, id, defaultValue, onChange, ...props },
    ref,
  ) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const [count, setCount] = useState(String(defaultValue ?? props.value ?? "").length);

    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={fieldId} className="text-small text-fg-muted">
            {label}
          </label>
        ) : null}
        <textarea
          id={fieldId}
          ref={ref}
          maxLength={maxLength}
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setCount(e.target.value.length);
            onChange?.(e);
          }}
          className={cn(
            "min-h-24 rounded border border-border bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-faint",
            "transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-info",
            error && "border-danger",
            className,
          )}
          {...props}
        />
        <div className="flex items-center justify-between">
          {error ? (
            <span className="text-small text-danger">{error}</span>
          ) : helper ? (
            <span className="text-small text-fg-faint">{helper}</span>
          ) : (
            <span />
          )}
          {showCount && maxLength ? (
            <span className="mono text-small text-fg-faint">
              {count}/{maxLength}
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
