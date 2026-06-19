"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
}

/** Стилизованный нативный select (доступный из коробки). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, helper, id, children, ...props }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={selectId} className="text-small text-fg-muted">
            {label}
          </label>
        ) : null}
        <select
          id={selectId}
          ref={ref}
          className={cn(
            "h-10 rounded border border-border bg-surface px-3 text-body text-fg",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-info",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {helper ? <span className="text-small text-fg-faint">{helper}</span> : null}
      </div>
    );
  },
);
Select.displayName = "Select";
