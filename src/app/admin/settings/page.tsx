"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { ACTIVATION_FEE_MICRO, IS_CHAIN } from "@/lib/chain/addresses";
import { useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

/**
 * Admin → Settings. A read-only readout of the platform's runtime configuration. The sensitive knobs
 * (operator/treasury wallets, OpenAI key, chain mode) are SERVER-side env (never in the client bundle,
 * ADR 0008/0009) — they can't be edited here, so we show what's known and point to where actions live.
 */
export default function AdminSettingsPage() {
  const session = useSession().data;
  const mode = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock";

  const rows: { label: string; value: React.ReactNode; hint?: string }[] = [
    { label: "Data source", value: <span className="mono uppercase">{mode}</span>, hint: "NEXT_PUBLIC_DATA_SOURCE — which DataProvider is live." },
    {
      label: "Money path",
      value: IS_CHAIN ? "On-chain (Solana)" : "Off-chain (simulated)",
      hint: IS_CHAIN ? "Crowns settle as real USDC transfers." : "In mock/api crowns are simulated — no wallet, no chain.",
    },
    { label: "Activation fee", value: <Amount micro={ACTIVATION_FEE_MICRO} variant="money" />, hint: "One-time fee to activate a realm (BASIC → ACTIVE)." },
    { label: "Protocol fee", value: <span className="mono">3%</span>, hint: "Taken from each crown; the rest goes straight to the payout wallet (non-custodial)." },
    {
      label: "You",
      value: session?.address ? (
        <span className="mono">{shortAddress(session.address)}{session.isOperator ? " · operator" : ""}</span>
      ) : (
        <span className="text-fg-faint">not connected</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Settings</h1>
        <p className="text-small text-fg-faint">
          Platform runtime configuration. Sensitive keys live server-side and aren&apos;t editable here.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-small text-fg">{r.label}</span>
              {r.hint ? <span className="text-caption text-fg-faint">{r.hint}</span> : null}
            </div>
            <div className="shrink-0 text-small text-fg-muted">{r.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-caption uppercase tracking-wide text-fg-faint">Where actions live</span>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/ops"
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            Moderation / T&amp;S → Ops
          </Link>
          <Link
            href="/admin/tests"
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            Test data → Tests
          </Link>
        </div>
      </div>
    </div>
  );
}
