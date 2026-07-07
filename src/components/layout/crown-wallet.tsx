"use client";

import Link from "next/link";
import { Monogram } from "@/components/domain/header-actions";
import { useDevControls, useDonorOverview, useSession } from "@/lib/data/hooks";
import { demoAddress } from "@/lib/data/demo-seed";

/**
 * Wallet control in the CROWN header. Connected → ONE control: avatar + "Personal Space" (links to /space).
 * No dropdown — profile, wallet address and Disconnect all live inside Personal Space → Account.
 * Phase 1 (mock): "Connect wallet" pins the session to the demo supporter `max` via dev-controls.
 */
export function CrownWallet() {
  const { data: session, isLoading } = useSession();
  const dev = useDevControls();

  if (isLoading) {
    return <div className="h-9 w-32 animate-pulse rounded bg-surface-2" aria-hidden />;
  }

  if (!session?.address) {
    return (
      <button
        type="button"
        onClick={() => dev.available && dev.setAddress(demoAddress("max"))}
        className="inline-flex h-9 items-center rounded-lg border border-money-dim bg-money-bg/40 px-3.5 font-body text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
      >
        Connect wallet
      </button>
    );
  }

  return <IdentityLink address={session.address} />;
}

/** Avatar + "Personal Space", one link. Avatar/name come from the connected profile (fallback: the address). */
function IdentityLink({ address }: { address: string }) {
  const overview = useDonorOverview(address);
  const monoName = overview.data?.displayName?.trim() || address;
  const avatarUrl = overview.data?.avatarUrl;
  return (
    <Link
      href="/space"
      className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface pl-3.5 pr-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
    >
      Personal Space
      <Monogram name={monoName} avatarUrl={avatarUrl} size="xs" />
    </Link>
  );
}
