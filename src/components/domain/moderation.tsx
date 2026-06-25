"use client";

import { Amount } from "./amount";
import { ModerationMenu } from "./moderation-menu";
import { ReportDialog } from "./report-dialog";
import { Button } from "@/components/ui/button";
import { cn, shortAddress, timeAgo } from "@/lib/utils";
import type { Address, MessageRef, MicroUSDC, ModerationVerdict } from "@/lib/data/types";

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

/** Строка очереди модерации: донор + сумма + текст + авто-вердикт + язык + «Показать/Скрыть». */
export function ModerationItem({
  message,
  donor,
  amount,
  onShow,
  onHide,
  pending,
}: {
  message: MessageRef;
  donor?: Address;
  amount?: MicroUSDC;
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
          {donor ? <span className="text-small text-fg">{shortAddress(donor)}</span> : null}
          {amount !== undefined ? <Amount micro={amount} /> : null}
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
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 rounded border border-danger bg-danger-bg p-2 text-small text-fg-muted">
            Авто-карантин (hard-block). Показать нельзя — эскалация в T&amp;S.
          </p>
          {donor ? <ModerationMenu channelId={message.channelId} donor={donor} message={message} /> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="money" size="sm" onClick={onShow} loading={pending}>
            Показать
          </Button>
          <Button variant="secondary" size="sm" onClick={onHide} disabled={pending}>
            Скрыть
          </Button>
          {donor ? <ModerationMenu channelId={message.channelId} donor={donor} message={message} /> : null}
          <span className="ml-auto">
            <ReportDialog
              messageId={message.id}
              channelId={message.channelId}
              label="Пожаловаться"
            />
          </span>
        </div>
      )}

      <p className="text-small text-fg-faint">
        Деньги и standing донора уже зачтены — решение касается только публикации текста.
      </p>
    </div>
  );
}
