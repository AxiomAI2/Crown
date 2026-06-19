"use client";

import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import type { MessageRef, ModerationVerdict } from "@/lib/data/types";

const VERDICT_STYLE: Record<ModerationVerdict, { label: string; cls: string }> = {
  CLEAR: { label: "CLEAR", cls: "border-info text-info" },
  FLAG: { label: "FLAG", cls: "border-warn text-warn" },
  HARD_BLOCK: { label: "HARD-BLOCK", cls: "border-danger text-danger" },
};

export function VerdictBadge({ verdict }: { verdict: ModerationVerdict }) {
  const v = VERDICT_STYLE[verdict];
  return (
    <span className={cn("rounded-pill border px-2 py-0.5 text-small", v.cls)}>{v.label}</span>
  );
}

/** Строка очереди модерации: текст + авто-вердикт + язык + «Показать/Скрыть». */
export function ModerationItem({
  message,
  onShow,
  onHide,
  pending,
}: {
  message: MessageRef;
  onShow: () => void;
  onHide: () => void;
  pending?: boolean;
}) {
  const hardBlock = message.autoVerdict === "HARD_BLOCK";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-surface p-4",
        message.autoVerdict === "FLAG" ? "border-warn" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {message.autoVerdict ? <VerdictBadge verdict={message.autoVerdict} /> : null}
          {message.lang ? (
            <span className="mono text-small text-fg-faint">{message.lang}</span>
          ) : null}
        </div>
        <span className="text-small text-fg-faint" title={message.createdAt}>
          {timeAgo(message.createdAt)}
        </span>
      </div>

      <p className="text-body text-fg">{message.text}</p>

      {hardBlock ? (
        <p className="rounded border border-danger bg-danger-bg p-2 text-small text-fg-muted">
          Авто-карантин (hard-block). Показать нельзя — эскалация в T&amp;S.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="money" size="sm" onClick={onShow} loading={pending}>
            Показать
          </Button>
          <Button variant="secondary" size="sm" onClick={onHide} disabled={pending}>
            Скрыть
          </Button>
        </div>
      )}

      <p className="text-small text-fg-faint">
        Деньги и standing донора уже зачтены — решение касается только публикации текста.
      </p>
    </div>
  );
}
