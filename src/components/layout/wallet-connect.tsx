"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useDisconnect, useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

/** Подключить кошелёк / адрес + выход (frontend/components.md). Мок-сессия в Фазе 1. */
export function WalletConnectButton() {
  const { data: session, isLoading } = useSession();
  const disconnect = useDisconnect();

  if (isLoading) {
    return <div className="h-8 w-32 animate-pulse rounded bg-surface-raised" />;
  }
  if (session?.address) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/me" className="mono text-small text-fg hover:text-status">
          {shortAddress(session.address)}
        </Link>
        <Button variant="ghost" size="sm" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
          Выйти
        </Button>
      </div>
    );
  }
  return (
    <Button asChild size="sm" variant="secondary">
      <Link href="/connect">Подключить кошелёк</Link>
    </Button>
  );
}
