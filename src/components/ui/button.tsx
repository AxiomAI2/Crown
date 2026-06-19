"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-info disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // основной CTA — интерактивный акцент (info), НЕ money (тот резервируем под финальное)
        primary: "bg-info text-[#0a0c14] hover:brightness-110",
        secondary:
          "border border-border bg-surface-raised text-fg hover:border-border-strong",
        ghost: "text-fg-muted hover:bg-surface hover:text-fg",
        danger: "bg-danger text-[#1a0b0e] hover:brightness-110",
        // только для ПОДТВЕРЖДЁННОГО денежного действия (design-system.md §2)
        money: "bg-money text-[#06140d] hover:brightness-110",
      },
      size: {
        sm: "h-8 px-3 text-small",
        md: "h-10 px-4 text-small",
        lg: "h-12 px-6 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* Slot требует РОВНО один дочерний элемент → при asChild отдаём children как есть
            (loading-спиннер только в режиме настоящей кнопки). */}
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Spinner /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

export { buttonVariants };
