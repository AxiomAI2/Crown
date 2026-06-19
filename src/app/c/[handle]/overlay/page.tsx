"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Amount } from "@/components/domain/amount";
import { TierBadge } from "@/components/domain/standing";
import { useData } from "@/lib/data/context";
import { useChannel } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";
import type { OverlayEvent } from "@/lib/data/types";

/**
 * Оверлей для OBS — публичный вид БЕЗ хрома, прозрачный фон. Инвариант: только SHOWN-донаты и tier-up;
 * HELD/HIDDEN/QUARANTINED — никогда. События приходят через подписку DataProvider.subscribeOverlay.
 */
export default function OverlayPage() {
  const { handle } = useParams<{ handle: string }>();
  const channelQ = useChannel(handle);
  const channelId = channelQ.data?.id;
  const data = useData();
  const [alerts, setAlerts] = useState<{ id: number; event: OverlayEvent }[]>([]);

  useEffect(() => {
    if (!channelId) return;
    let n = 0;
    const unsub = data.subscribeOverlay(channelId, (event) => {
      n += 1;
      setAlerts((prev) => [{ id: n, event }, ...prev].slice(0, 20));
    });
    return unsub;
  }, [channelId, data]);

  return (
    <div className="min-h-screen bg-transparent p-6">
      {alerts.length === 0 ? (
        <div className="text-small text-fg-faint">Ожидание донатов… (оверлей для OBS)</div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map(({ id, event }) => (
            <div key={id} className="rounded-lg border border-status bg-surface-raised p-3">
              {event.kind === "donation_shown" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-small text-fg">{shortAddress(event.donation.donor)}</span>
                    <Amount micro={event.donation.amount} variant="money" />
                  </div>
                  {event.donation.message ? (
                    <p className="text-body text-fg">{event.donation.message.text}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-small text-fg">{shortAddress(event.donor)}</span>
                  <span className="text-small text-fg-muted">поднял тир →</span>
                  <TierBadge tier={event.tier} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
