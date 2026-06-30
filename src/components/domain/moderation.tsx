"use client";

import Link from "next/link";
import { Amount } from "./amount";
import { ModerationMenu } from "./moderation-menu";
import { TierBadge } from "./standing";
import { Button } from "@/components/ui/button";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { useStanding } from "@/lib/data/hooks";
import { cn, collapseWhitespace, shortAddress, timeAgo } from "@/lib/utils";
import type { Address, MessageRef, MicroUSDC, ModerationVerdict } from "@/lib/data/types";

// Бейдж только для того, что требует внимания (FLAG/HARD_BLOCK); CLEAR — без метки, чтобы не зашумлять.
const VERDICT: Partial<Record<ModerationVerdict, { label: string; cls: string }>> = {
  FLAG: { label: "Подозрительное", cls: "border-warn text-warn" },
  HARD_BLOCK: { label: "Запрещённое", cls: "border-danger text-danger" },
};

/**
 * Строка очереди модерации (без рамки, с нижним разделителем): ник → профиль + бейдж тира донора + (если есть)
 * авто-вердикт, сумма справа, текст, снизу время и действия «Показать»/«Скрыть» + меню «…». HARD_BLOCK —
 * показать нельзя (карантин). Тир донора подтягивается по standing на этом канале.
 */
export function ModerationItem({
  message,
  donor,
  donorName,
  amount,
  onShow,
  onHide,
  pending,
}: {
  message: MessageRef;
  donor?: Address;
  donorName?: string;
  amount?: MicroUSDC;
  onShow: () => void;
  onHide: () => void;
  pending?: boolean;
}) {
  const standing = useStanding(message.channelId, donor ?? null);
  const tier = standing.data?.tier;
  const hardBlock = message.autoVerdict === "HARD_BLOCK";
  const verdict = message.autoVerdict ? VERDICT[message.autoVerdict] : undefined;
  const name = donorName?.trim() || (donor ? shortAddress(donor) : "Аноним");

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {donor ? (
            <Link href={`/u/${donor}`} className="truncate font-display text-fg hover:text-status">
              {name}
            </Link>
          ) : (
            <span className="font-display text-fg">{name}</span>
          )}
          {tier ? <TierBadge tier={tier} /> : null}
          {verdict ? (
            <span className={cn("rounded-pill border px-2 py-0.5 text-small", verdict.cls)}>
              {verdict.label}
            </span>
          ) : null}
        </div>
        {amount !== undefined ? <Amount micro={amount} variant="money" className="shrink-0" /> : null}
      </div>

      <p className="break-words text-body text-fg">{collapseWhitespace(message.text)}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small text-fg-faint" title={message.createdAt}>
          {timeAgo(message.createdAt)}
        </span>
        {message.lang ? <span className="mono text-small text-fg-faint">{message.lang}</span> : null}

        <div className="ml-auto flex items-center gap-2">
          {hardBlock ? (
            <span className="text-small text-danger">Авто-карантин — показать нельзя</span>
          ) : (
            <>
              {/* Один `pending` на обе кнопки → не вешаем спиннер на «Показать» (иначе он крутится и при «Скрыть»).
                  Обе просто блокируются на время операции. */}
              <Button variant="secondary" size="sm" onClick={onShow} disabled={pending}>
                <EyeIcon className="h-4 w-4" />
                Показать
              </Button>
              <Button variant="secondary" size="sm" onClick={onHide} disabled={pending}>
                <EyeOffIcon className="h-4 w-4" />
                Скрыть
              </Button>
            </>
          )}
          <ModerationMenu
            channelId={message.channelId}
            donor={donor}
            message={message}
            allowToggleState={false}
          />
        </div>
      </div>
    </div>
  );
}
