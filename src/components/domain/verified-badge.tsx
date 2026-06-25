"use client";

import { CheckIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Ненавязчивая галочка «канал активирован» рядом с ником: просто приглушённая иконка-галочка (без яркого
 * кружка), при наведении — тултип. Активация разблокирует донат-с-текстом; у BASIC галочки нет.
 */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label="Канал активирован"
          className={cn("inline-flex shrink-0 cursor-default text-fg-muted", className)}
        >
          <CheckIcon className="h-4 w-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Данный канал активирован</TooltipContent>
    </Tooltip>
  );
}
