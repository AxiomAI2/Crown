"use client";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Loading-плейсхолдер. Форма должна совпадать с финальным контентом (без layout-shift). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-raised", className)} />;
}

/** Пустое состояние — приглашение к действию (components.md §1). */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      <h3 className="text-h3 text-fg">{title}</h3>
      {description ? <p className="max-w-md text-small text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Ошибка — что случилось + как починить + «Повторить» (не извиняется, не туманит). */
export function ErrorState({
  title = "Что-то пошло не так",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-danger bg-danger-bg px-6 py-12 text-center">
      <h3 className="text-h3 text-fg">{title}</h3>
      {description ? <p className="max-w-md text-small text-fg-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
