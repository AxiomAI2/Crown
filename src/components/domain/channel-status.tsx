import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ChannelStatus } from "@/lib/data/types";

/** Баннер состояния канала (BASIC/SUSPENDED/BANNED). ACTIVE → ничего. */
export function ChannelStatusBanner({ status }: { status: ChannelStatus }) {
  if (status === "ACTIVE") return null;

  if (status === "BASIC") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-status bg-status-bg p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-h3 text-fg">Канал не активирован</span>
          <span className="text-small text-fg-muted">
            Активируй канал, чтобы разблокировать донаты-с-текстом, публичную индексацию и оверлей.
          </span>
        </div>
        <Button asChild>
          <Link href="/studio/activation">Активировать канал</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-danger bg-danger-bg p-4">
      <span className="text-h3 text-fg">
        {status === "SUSPENDED" ? "Канал приостановлен" : "Канал заблокирован"}
      </span>
      <p className="text-small text-fg-muted">
        {status === "SUSPENDED"
          ? "Канал на ревью у оператора. Дождись решения или обратись в поддержку."
          : "Канал заблокирован платформой. Возврат — только новый кошелёк и повторная активация."}
      </p>
    </div>
  );
}
