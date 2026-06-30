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
    // Контролируемый value → счётчик считаем от него (иначе при программной смене value — очистке после
    // отправки, async-предзаполнении — он бы завис). Неконтролируемый → ведём внутренним state по onChange.
    const [internalCount, setInternalCount] = useState(String(defaultValue ?? "").length);
    const count = props.value != null ? String(props.value).length : internalCount;

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
            setInternalCount(e.target.value.length);
            onChange?.(e);
          }}
          className={cn(
            "scroll-thin min-h-24 resize-none rounded border border-border bg-[var(--bg)] px-3 py-2 text-body text-fg placeholder:text-fg-faint",
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
