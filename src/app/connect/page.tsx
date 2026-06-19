"use client";

import Link from "next/link";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useDevControls, useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";
import type { IdentityKey } from "@/lib/data/fixtures";

const WALLETS: { key: IdentityKey; label: string; sub: string }[] = [
  { key: "donorA", label: "Кошелёк донатера", sub: "address-only" },
  { key: "donorB", label: "Кошелёк с профилем", sub: "light profile · кит" },
  { key: "creatorL", label: "Кошелёк стримера", sub: "владелец @lumi" },
  { key: "operator", label: "Кошелёк оператора", sub: "T&S" },
];

export default function ConnectPage() {
  const sessionQ = useSession();
  const dev = useDevControls();
  const address = sessionQ.data?.address ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Подключение кошелька</h1>
          <p className="text-fg-muted">
            Sign-In-With-Solana — без газа, без пароля. Кошелёк = аккаунт. В Фазе 1 — мок-кошельки;
            реальные кошельки появятся в Фазе 3.
          </p>
        </div>

        {sessionQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : address ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <span className="text-small text-fg-muted">Подключён</span>
            <span className="mono text-h3 text-fg">{shortAddress(address)}</span>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link href="/">На платформу</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => dev.setIdentity("guest")}>
                Выйти
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {WALLETS.map((w) => (
              <button
                key={w.key}
                onClick={() => dev.setIdentity(w.key)}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors duration-fast ease-ease hover:border-border-strong"
              >
                <div className="flex flex-col">
                  <span className="text-fg">{w.label}</span>
                  <span className="text-small text-fg-faint">{w.sub}</span>
                </div>
                <span className="text-small text-info">Подключить</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
