"use client";

import { Button } from "@/components/ui/button";
import { useDevControls, useDiscovery, useSession } from "@/lib/data/hooks";
import type { IdentityKey } from "@/lib/data/fixtures";

const IDENTITIES: IdentityKey[] = ["guest", "donorA", "donorB", "creatorL", "operator"];

/** Dev-тулбар (mock-data.md §4): переключение сессии, инъекция ошибок, сброс стора, проверка фикстур. */
export function DevToolbar() {
  const dev = useDevControls();
  const session = useSession();
  const discovery = useDiscovery();

  if (!dev.available) {
    return <p className="text-small text-fg-faint">Dev-контролы доступны только на мок-провайдере.</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-2">
        <span className="text-caption">Сессия (переключить идентичность)</span>
        <div className="flex flex-wrap gap-2">
          {IDENTITIES.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={dev.identityKey === k ? "primary" : "secondary"}
              onClick={() => dev.setIdentity(k)}
            >
              {k}
            </Button>
          ))}
        </div>
        <span className="mono text-small text-fg-muted">
          getSession() → {session.isLoading ? "loading…" : JSON.stringify(session.data)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={dev.failMode ? "danger" : "secondary"}
          onClick={() => dev.setFailMode(!dev.failMode)}
        >
          MOCK_FAIL: {dev.failMode ? "on" : "off"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dev.reset()}>
          Сбросить стор к сиду
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-caption">Фикстуры (listChannels)</span>
        <span className="mono text-small text-fg-muted">
          {discovery.isLoading
            ? "loading…"
            : discovery.error
              ? `error: ${(discovery.error as Error).message}`
              : (discovery.data?.items ?? [])
                  .map((c) => `@${c.handle} (${c.donorsCount}, ${c.topTierName})`)
                  .join("  ·  ") || "пусто"}
        </span>
      </div>
    </div>
  );
}
