"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Monogram } from "@/components/domain/header-actions";
import { useDevControls, useDonorOverview, useSession } from "@/lib/data/hooks";
import { demoAddress } from "@/lib/data/demo-seed";
import { fromMicro, shortAddress } from "@/lib/utils";

/**
 * Wallet control in the CROWN header.
 * Phase 1 (mock): "Connect wallet" pins the session to the demo supporter `max` (has Reign in every realm) via
 * the engine's dev-controls — we don't duplicate the real wallet logic. Phase 3: ChainConnect (SIWS) will sit here.
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

  return <IdentityMenu address={session.address} onDisconnect={() => dev.setAddress(null)} />;
}

function IdentityMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const overview = useDonorOverview(address);

  // Esc closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface pl-1 pr-3 transition-colors hover:border-border-strong"
      >
        <Monogram name={address} size="sm" />
        <span className="mono text-small text-fg-muted">{shortAddress(address)}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-xl shadow-black/40"
          >
            <div className="flex items-center gap-3 border-b border-border px-3 py-3">
              <Monogram name={address} size="md" />
              <div className="flex min-w-0 flex-col">
                <span className="mono text-small text-fg">{shortAddress(address)}</span>
                <span className="text-caption text-fg-faint">
                  {overview.data ? `$${Math.round(fromMicro(overview.data.totalDonated)).toLocaleString("en-US")} crowned` : "…"}
                </span>
              </div>
            </div>
            <MenuLink href="/me" onClick={() => setOpen(false)}>
              My profile &amp; Reign
            </MenuLink>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
              className="w-full border-t border-border px-3 py-2.5 text-left text-small text-fg-muted transition-colors hover:bg-surface-2 hover:text-danger"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="block px-3 py-2.5 text-small text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </Link>
  );
}
