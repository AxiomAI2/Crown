"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DevToolbar } from "@/components/layout/dev-toolbar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useDiscovery } from "@/lib/data/hooks";

// Quick sign-in as demo identities (address is deterministic from the label via demoAddress).
const QUICK = [
  { label: "Max · supporter", who: "max" },
  { label: "WhaleMoon · whale", who: "whalemoon" },
  { label: "PixelQueen · realm owner", who: "owner-pixel" },
  { label: "RaidBoss · realm owner", who: "owner-raid" },
  { label: "Fresh wallet · no history", who: "fresh-tester" },
];

// Demo set for seeding via the public API (creator + "silent" Crowns from various donors).
const DEMO_SEED: {
  owner: string;
  handle: string;
  name: string;
  desc: string;
  donations: [string, number][];
}[] = [
  {
    owner: "owner-pixel",
    handle: "pixelqueen",
    name: "PixelQueen",
    desc: "Pixel art & variety. Come draw with me.",
    donations: [["whalemoon", 61000], ["lena", 5400], ["max", 3200], ["artem", 640], ["kirill", 300], ["sonya", 220]],
  },
  {
    owner: "owner-mira",
    handle: "lofimira",
    name: "Mira",
    desc: "Lo-fi & synth jams every night.",
    donations: [["max", 8200], ["dana", 5100], ["roma", 1600], ["yulia", 780], ["nastya", 520]],
  },
  {
    owner: "owner-raid",
    handle: "raidboss",
    name: "RaidBoss",
    desc: "Soulslikes at zero damage. Watch me suffer.",
    donations: [["bigbag", 250000], ["whalemoon", 42000], ["oleg", 6100], ["max", 4300], ["grisha", 1100], ["artem", 560]],
  },
  {
    owner: "owner-marina",
    handle: "marinacooks",
    name: "Marina Cooks",
    desc: "Cooking streams. Tonight — tom yum.",
    donations: [["yulia", 5300], ["max", 2100], ["nastya", 900], ["dana", 610]],
  },
  {
    owner: "owner-dev",
    handle: "devbyte",
    name: "Devbyte",
    desc: "Live coding and viewer PR reviews.",
    donations: [["max", 5200], ["roma", 1400], ["kirill", 520]],
  },
  {
    owner: "owner-late",
    handle: "latenight",
    name: "Late Night",
    desc: "Late-night talk & synths.",
    donations: [["whalemoon", 30000], ["max", 2400], ["vika", 180]],
  },
];

/**
 * Admin → Tests. Dev tools (mock/api only — in chain you sign in via SIWS): wallet-less login,
 * test-data management (seed 6 realms via the public API / wipe the store).
 */
export default function AdminTestsPage() {
  const dev = useDevControls();
  const provider = useData();
  const qc = useQueryClient();
  const discovery = useDiscovery();
  const realmCount = discovery.data?.items.length ?? 0;
  const [seeding, setSeeding] = useState(false);

  async function seedDemo() {
    if (seeding) return;
    setSeeding(true);
    // Raw identity setter without a per-call cache reset (dev.available guarantees __setAddress is present).
    const setAddr = (provider as { __setAddress?: (a: string | null) => void }).__setAddress?.bind(provider);
    try {
      dev.reset(); // clear the store — otherwise handles/channels conflict (resets latencyScale to 1)
      // Instant mock calls during seeding: otherwise gate() adds 120–500ms to EACH of the ~30 calls.
      dev.setLatencyScale(0);
      if (!setAddr) throw new Error("Dev identity not available");
      let realms = 0;
      for (const r of DEMO_SEED) {
        setAddr(demoAddress(r.owner));
        const ch = await provider.createChannel({
          handle: r.handle,
          payoutAddress: demoAddress(`${r.owner}-payout`),
        });
        await provider.updateProfile({ displayName: r.name });
        try {
          await provider.updateChannelConfig(ch.id, { description: r.desc });
        } catch {
          /* description isn't critical */
        }
        for (const [donor, usdc] of r.donations) {
          setAddr(demoAddress(donor));
          try {
            // "silent" Crown (no text — on BASIC text is rejected)
            await provider.createDonation({ channelId: ch.id, amountUSDC: usdc });
          } catch {
            /* the mode may block an off-chain Crown (CHAIN_MODE) — the realm is created either way */
          }
        }
        realms += 1;
      }
      setAddr(null);
      qc.invalidateQueries();
      toast({ variant: "success", title: `Seeded ${realms} demo realms`, description: "with supporters." });
    } catch (e) {
      qc.invalidateQueries();
      toast({
        variant: "error",
        title: "Seed failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      dev.setLatencyScale(1); // restore the normal mock delay
      setSeeding(false);
    }
  }

  function wipeAll() {
    dev.reset(); // clears realms, donors, profiles, the journal — and invalidates the cache
    toast({ variant: "success", title: "Wiped", description: "All test realms and users removed." });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-fg">Tests</h1>
        <p className="text-small text-fg-faint">
          Sign in without a wallet and manage test data. Dev only — works in mock/api mode.
        </p>
      </div>

      {!dev.available ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-small text-fg-muted">
          Dev tools are available only in <span className="mono">mock</span> / <span className="mono">api</span>{" "}
          mode (current mode has no wallet-less login). Switch{" "}
          <span className="mono">NEXT_PUBLIC_DATA_SOURCE</span>.
        </div>
      ) : (
        <>
          {/* Test data */}
          <section className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">
              Test data · {realmCount} realm{realmCount === 1 ? "" : "s"} now
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={seedDemo} loading={seeding} disabled={seeding}>
                Seed 6 demo realms
              </Button>
              <Button size="sm" variant="danger" onClick={wipeAll} disabled={seeding}>
                Wipe all realms &amp; users
              </Button>
            </div>
            <p className="text-caption text-fg-faint">
              «Seed» wipes then rebuilds 6 demo realms (pixelqueen, lofimira, raidboss, marinacooks, devbyte,
              latenight) with their supporters via the public API; «Wipe» removes every test realm and user.
            </p>
          </section>

          {/* Wallet-less login */}
          <section className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Quick sign-in</span>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <Button
                  key={q.who}
                  size="sm"
                  variant="secondary"
                  onClick={() => dev.setAddress(demoAddress(q.who))}
                >
                  {q.label}
                </Button>
              ))}
            </div>
          </section>

          <DevToolbar />
        </>
      )}
    </div>
  );
}
