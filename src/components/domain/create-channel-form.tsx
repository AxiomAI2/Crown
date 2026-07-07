"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AvatarEditor } from "@/components/domain/avatar-editor";
import {
  inputsFromLinks,
  LinkEditor,
  type LinkInputs,
  linksFromInputs,
} from "@/components/domain/link-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { DEFAULT_TIERS } from "@/lib/data/fixtures";
import { useProfile, useSession } from "@/lib/data/hooks";
import { DataError } from "@/lib/data/provider";
import type { Perk } from "@/lib/data/types";
import { cn, isLikelyBase58Address } from "@/lib/utils";

// Must match the server's canonical rule (mock-provider.createChannel): a–z, 0–9, underscore. The client
// used to allow hyphens, so hyphenated handles passed the form and were rejected server-side at submit.
const HANDLE_RE = /^[a-z0-9_]{3,32}$/;
const STEPS = ["Profile", "Address", "Tiers"] as const;

interface TierDraft {
  name: string;
  threshold: number;
  color: string;
  badge: string;
  perks: Perk[];
}

/**
 * Step-by-step realm creation wizard (in the spirit of FusionPay): Profile (name/description/avatar) → Address
 * (handle/payout) → Tiers. Submit on the last step: createChannel → updateProfile → updateChannelConfig.
 */
export function CreateChannelForm() {
  const sessionQ = useSession();
  const provider = useData();
  const qc = useQueryClient();
  const address = sessionQ.data?.address ?? null;

  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("");
  const [payout, setPayout] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [description, setDescription] = useState("");
  // Social links — validated against each platform's OFFICIAL domain (LinkEditor / normalizeChannelLink):
  // a YouTube link must be youtube.com/@…, an X link x.com/… etc. Phishing/scam URLs are rejected inline.
  const [linkInputs, setLinkInputs] = useState<LinkInputs>([]);
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    DEFAULT_TIERS.map((t) => ({
      name: t.name,
      threshold: t.threshold,
      color: t.color,
      badge: t.badge,
      perks: t.perks,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  // Handle availability, checked inline on the Address step (not left to surface as a toast at submit).
  // null = unknown/not-yet-checked, false = free, true = taken.
  const [handleTaken, setHandleTaken] = useState<boolean | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);
  // The realm name IS the owner's profile name (one name per wallet, types.ts §ChannelConfig). We seed the
  // form from the existing profile so a returning user edits their real name consciously instead of blanking
  // or silently overwriting it. `profileTouched` stops the seed from clobbering something they already typed.
  const profileQ = useProfile(address);
  const profile = profileQ.data ?? null;
  const [profileTouched, setProfileTouched] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (address && !payout) setPayout(address);
  }, [address, payout]);

  const handleValid = HANDLE_RE.test(handle);
  const payoutValid = isLikelyBase58Address(payout.trim());
  const avatar = avatarUrl.trim();
  const avatarValid = avatar === "" || /^https?:\/\//i.test(avatar) || /^data:image\//i.test(avatar);
  const previewName = displayName.trim() || (handle ? `@${handle}` : "?");

  // Seed the profile fields once, when the existing profile loads and the user hasn't typed yet.
  useEffect(() => {
    if (seeded || profileTouched || !profile) return;
    if (profile.displayName) setDisplayName(profile.displayName);
    if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
    if (profile.links?.length) setLinkInputs(inputsFromLinks(profile.links));
    setSeeded(true);
  }, [seeded, profileTouched, profile]);

  // Debounced availability probe. The server stays authoritative (submit re-checks); this is only inline UX.
  useEffect(() => {
    if (!handleValid) {
      setHandleTaken(null);
      setCheckingHandle(false);
      return;
    }
    const h = handle.trim().toLowerCase();
    let cancelled = false;
    setCheckingHandle(true);
    setHandleTaken(null);
    const timer = setTimeout(async () => {
      try {
        const existing = await provider.getChannel(h);
        if (!cancelled) setHandleTaken(existing !== null);
      } catch {
        // Probe failed — don't hard-block; let the server decide at submit.
        if (!cancelled) setHandleTaken(null);
      } finally {
        if (!cancelled) setCheckingHandle(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, handleValid, provider]);

  const isLast = step === STEPS.length - 1;
  const canNext =
    step === 0
      ? avatarValid
      : step === 1
        ? handleValid && payoutValid && !checkingHandle && handleTaken !== true
        : true;
  const canSubmit = handleValid && payoutValid && avatarValid && handleTaken !== true && !submitting;

  const setTier = (i: number, patch: Partial<TierDraft>) =>
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const addTier = () =>
    setTiers((prev) => [
      ...prev,
      {
        name: "New tier",
        threshold: (prev[prev.length - 1]?.threshold ?? 0) + 1000,
        color: "#C9A24B",
        badge: "rookie",
        perks: [],
      },
    ]);
  const removeTier = (i: number) =>
    setTiers((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);

    // Step A — create the realm. This is the ONLY failure that means "realm not created".
    let channel;
    try {
      channel = await provider.createChannel({ handle, payoutAddress: payout.trim() });
    } catch (e) {
      if (e instanceof DataError && e.code === "HANDLE_TAKEN") {
        // Someone grabbed it between the inline check and submit — surface it on the Handle step, not a dead toast.
        setHandleTaken(true);
        setStep(1);
      }
      toast({
        variant: "error",
        title: "Couldn't create realm",
        description: e instanceof Error ? e.message : String(e),
      });
      setSubmitting(false);
      return;
    }

    // The realm now EXISTS. Everything below is optional setup: a failure here is partial, never "not created".
    const nextName = displayName.trim();
    // Canonical, validated links (invalid/phishing dropped by linksFromInputs → normalizeChannelLink).
    const nextLinks = linksFromInputs(linkInputs);
    const profileChanged =
      (nextName !== "" && nextName !== (profile?.displayName ?? "")) ||
      (avatar !== "" && avatar !== (profile?.avatarUrl ?? "")) ||
      JSON.stringify(nextLinks) !== JSON.stringify(profile?.links ?? []);
    try {
      // Only write the profile when the name/avatar/links actually changed — never silently re-stamp the personal profile.
      if (profileChanged) {
        await provider.updateProfile({
          displayName: nextName || undefined,
          avatarUrl: avatar || undefined,
          links: nextLinks,
        });
      }
      const sorted = [...tiers]
        .map((t) => ({ ...t, name: t.name.trim() || "Tier", threshold: Math.max(0, Math.round(t.threshold)) }))
        .sort((a, b) => a.threshold - b.threshold);
      await provider.updateChannelConfig(channel.id, {
        description: description.trim() || undefined,
        tiers: sorted,
      });
      qc.invalidateQueries();
      toast({ variant: "success", title: "Realm created", description: `@${handle} — status BASIC.` });
    } catch (e) {
      qc.invalidateQueries(); // the realm is real — make sure the app reflects it
      toast({
        variant: "info",
        title: "Realm created — finish setup in Space",
        description: `@${handle} is live, but some settings didn't save: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 pt-4 sm:pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Create realm</h1>
        <p className="text-fg-muted">
          Set up your realm in a few steps. Created with <span className="mono">BASIC</span> status —
          free; one realm per wallet.
        </p>
      </div>

      <Stepper current={step} />

      {/* Step 1 — Profile */}
      {step === 0 ? (
        <section className="flex flex-col gap-4">
          <Input
            label="Display name"
            placeholder="My Realm"
            value={displayName}
            onChange={(e) => {
              setProfileTouched(true);
              setDisplayName(e.target.value);
            }}
            helper="Your public name across the app — this is your profile name (one name per wallet), not a realm-only label."
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-fg-muted">Avatar</span>
            <AvatarEditor
              name={previewName}
              value={avatarUrl}
              onChange={(v) => {
                setProfileTouched(true);
                setAvatarUrl(v);
              }}
            />
          </div>
          <Textarea
            label="Description"
            placeholder="What's your realm about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-fg-muted">Socials (optional)</span>
            <LinkEditor value={linkInputs} onChange={setLinkInputs} />
            <p className="text-caption text-fg-faint">
              Only official profile links are accepted — YouTube must be youtube.com, X must be x.com, etc.
              Anything else is rejected (no phishing).
            </p>
          </div>
        </section>
      ) : null}

      {/* Step 2 — Address */}
      {step === 1 ? (
        <section className="flex flex-col gap-4">
          <Input
            label="Handle"
            placeholder="my_realm"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            helper={
              checkingHandle
                ? "Checking availability…"
                : handleValid && handleTaken === false
                  ? `Available — your realm's public URL: /c/${handle.trim()}`
                  : `Your realm's public URL: /c/${handle.trim() || "your-handle"} — a–z, 0–9, underscore; 3–32 chars. This is a name, not a wallet.`
            }
            error={
              handle !== "" && !handleValid
                ? "3–32 lowercase letters, digits or underscores (not a wallet address)"
                : handleTaken === true
                  ? `@${handle} is already taken — pick another`
                  : undefined
            }
          />
          <Input
            label="Payout wallet address"
            mono
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
            helper="Solana address where crowns (USDC) land. Defaults to your login address."
            error={payout !== "" && !payoutValid ? "Looks like an incomplete address" : undefined}
          />
        </section>
      ) : null}

      {/* Step 3 — Tiers */}
      {step === 2 ? (
        <section className="flex flex-col gap-4">
          <p className="text-small text-fg-faint">
            Rank ladder inside your realm — pre-filled with sensible defaults, editable anytime in
            Customization.
          </p>
          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[1fr_100px_44px_36px] gap-2 px-1 text-caption uppercase tracking-wide text-fg-faint sm:grid">
              <span>Name</span>
              <span>Reign ≥</span>
              <span>Color</span>
              <span />
            </div>
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_44px_36px] items-center gap-2">
                <Input value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} />
                <Input
                  mono
                  value={String(t.threshold)}
                  onChange={(e) => setTier(i, { threshold: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                />
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => setTier(i, { color: e.target.value })}
                  className="h-10 w-full cursor-pointer rounded border border-border bg-surface"
                  aria-label="Tier color"
                />
                <button
                  type="button"
                  onClick={() => removeTier(i)}
                  disabled={tiers.length <= 1}
                  aria-label="Remove tier"
                  className="grid h-10 place-items-center rounded-md border border-border text-fg-faint transition-colors hover:border-border-strong hover:text-danger disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addTier}
            className="w-fit rounded-md border border-border px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            + Add tier
          </button>
        </section>
      ) : null}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {isLast ? (
          <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
            Create realm
          </Button>
        ) : (
          <Button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-small transition-colors",
              i === current ? "bg-money-bg text-money" : "text-fg-faint",
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 flex-none place-items-center rounded-full border text-[11px]",
                i <= current ? "border-money text-money" : "border-border text-fg-faint",
              )}
            >
              {i < current ? "✓" : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </div>
          {i < STEPS.length - 1 ? <div className="h-px w-5 bg-border sm:w-8" /> : null}
        </div>
      ))}
    </div>
  );
}
