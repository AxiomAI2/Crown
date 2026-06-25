"use client";

import Link from "next/link";
import { Amount } from "./amount";
import { ModerationMenu } from "./moderation-menu";
import { Button } from "@/components/ui/button";
import { channelHue, cn, shortAddress, timeAgo } from "@/lib/utils";
import type { Address, MessageRef, MicroUSDC, ModerationVerdict } from "@/lib/data/types";

// Бейдж только для того, что требует внимания (FLAG/HARD_BLOCK); CLEAR — без метки, чтобы не зашумлять.
const VERDICT: Partial<Record<ModerationVerdict, { label: string; cls: string }>> = {
  FLAG: { label: "Подозрительное", cls: "border-warn text-warn" },
  HARD_BLOCK: { label: "Запрещённое", cls: "border-danger text-danger" },
};

/** Аватар-монограмма донора со стабильным цветом (как на профиле/в карточках каналов). */
function DonorAvatar({ seed }: { seed: string }) {
  const hue = channelHue(seed);
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-small"
      style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
    >
      {seed.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

/** Карточка очереди: донор (аватар + ник → профиль) и сумма сверху, текст в блоке-цитате, действия снизу. */
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
  const hardBlock = message.autoVerdict === "HARD_BLOCK";
  const verdict = message.autoVerdict ? VERDICT[message.autoVerdict] : undefined;
  const named = Boolean(donorName?.trim());
  const name = donorName?.trim() || (donor ? shortAddress(donor) : "Аноним");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-surface p-4",
        hardBlock ? "border-danger" : message.autoVerdict === "FLAG" ? "border-warn" : "border-border",
      )}
    >
      {/* Донор + сумма */}
      <div className="flex items-center gap-3">
        {donor ? <DonorAvatar seed={named ? name : donor} /> : null}
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          {donor ? (
            <Link href={`/u/${donor}`} className="w-fit truncate font-display text-fg hover:text-status">
              {name}
            </Link>
          ) : (
            <span className="font-display text-fg">{name}</span>
          )}
          {donor && named ? (
            <span className="mono truncate text-small text-fg-faint">{shortAddress(donor)}</span>
          ) : null}
        </div>
        {amount !== undefined ? <Amount micro={amount} variant="money" className="shrink-0 text-h3" /> : null}
      </div>

      {/* Текст — главный фокус */}
      <p className="whitespace-pre-wrap break-words rounded-md bg-surface-raised p-3 text-body text-fg">
        {message.text}
      </p>

      {/* Метки слева, действия справа */}
      <div className="flex flex-wrap items-center gap-2">
        {verdict ? (
          <span className={cn("rounded-pill border px-2 py-0.5 text-small", verdict.cls)}>
            {verdict.label}
          </span>
        ) : null}
        {message.lang ? <span className="mono text-small text-fg-faint">{message.lang}</span> : null}
        <span className="text-small text-fg-faint" title={message.createdAt}>
          {timeAgo(message.createdAt)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {hardBlock ? (
            <span className="text-small text-danger">Авто-карантин — показать нельзя</span>
          ) : (
            <>
              <Button variant="money" size="sm" onClick={onShow} loading={pending}>
                Показать
              </Button>
              <Button variant="secondary" size="sm" onClick={onHide} disabled={pending}>
                Скрыть
              </Button>
            </>
          )}
          {/* message НЕ передаём: «показать/скрыть это сообщение» уже есть кнопками выше — без дубля в меню */}
          {donor ? <ModerationMenu channelId={message.channelId} donor={donor} /> : null}
        </div>
      </div>
    </div>
  );
}
