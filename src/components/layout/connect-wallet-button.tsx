"use client";

import dynamic from "next/dynamic";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls } from "@/lib/data/hooks";

// Auth-aware sign-in button (accounts for both the wallet connection and an active SIWS session). Loaded
// dynamically (ssr:false), only in chain mode → the wallet-adapter stack stays out of the mock/api bundle.
const ChainConnect = dynamic(() => import("@/lib/chain/chain-connect").then((m) => m.ChainConnect), {
  ssr: false,
  loading: () => <div className="h-9 w-40 animate-pulse rounded bg-surface-raised" />,
});

/**
 * The single "Sign in" button. In chain — connects the wallet and, if needed, kicks off the SIWS signature
 * (ChainConnect). In dev (mock/api) there's no wallet, so it does the dev-login (impersonate the seeded demo
 * identity) — the SAME path as the header's CrownWallet. This way guest CTAs (donate on a realm, /space, /me,
 * the /ops gate) aren't dead ends: previously this returned null in mock and the button simply vanished.
 */
export function ConnectWalletButton() {
  if (IS_CHAIN) return <ChainConnect />;
  return <DevConnectButton />;
}

/** Dev/mock sign-in: no wallet — impersonate a seeded demo identity via dev-controls. */
function DevConnectButton() {
  const dev = useDevControls();
  if (!dev.available) return null; // chain/icp → dev-controls off (shouldn't reach here, IS_CHAIN handled above)
  return (
    <button
      type="button"
      onClick={() => dev.setAddress(demoAddress("max"))}
      className="inline-flex h-9 items-center rounded-lg border border-money-dim bg-money-bg/40 px-3.5 font-body text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
    >
      Connect wallet
    </button>
  );
}
