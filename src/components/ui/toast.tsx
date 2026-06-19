"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "error" | "info";

export interface ToastInput {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Императивно показать тост из любого места (success/error/info). */
export function toast(input: ToastInput): void {
  const item: ToastItem = { id: ++counter, variant: "default", duration: 4000, ...input };
  listeners.forEach((l) => l(item));
}

const variantBorder: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-money",
  error: "border-danger",
  info: "border-info",
};

/** Рендерится один раз в Providers. Подписывается на очередь тостов. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const l = (t: ToastItem) => setItems((prev) => [...prev, t]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          duration={t.duration}
          onOpenChange={(open) => {
            if (!open) remove(t.id);
          }}
          className={cn(
            "flex flex-col gap-1 rounded border bg-surface-raised px-4 py-3 text-fg shadow-lg",
            variantBorder[t.variant ?? "default"],
          )}
        >
          {t.title ? (
            <ToastPrimitive.Title className="text-small font-medium">{t.title}</ToastPrimitive.Title>
          ) : null}
          {t.description ? (
            <ToastPrimitive.Description className="text-small text-fg-muted">
              {t.description}
            </ToastPrimitive.Description>
          ) : null}
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-[min(92vw,24rem)] flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
