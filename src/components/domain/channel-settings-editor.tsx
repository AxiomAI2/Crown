"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TierEditor } from "@/components/domain/settings";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { CHANNEL_DESC_MAX } from "@/lib/channel-links";
import { useAttestPayout, useChannelConfig, useMyChannel, useUpdateConfig } from "@/lib/data/hooks";
import { fromMicro, isLikelyBase58Address, toMicro } from "@/lib/utils";
import type { Channel, ChannelConfig, ConfigPatch, ModeratorRef, Tier } from "@/lib/data/types";

interface Draft {
  description: string;
  tiers: Tier[];
  minDonation: bigint;
  minDonationWithText: bigint;
  messageMaxLen: number;
  nameMode: ChannelConfig["nameMode"];
  textShowMode: ChannelConfig["textShowMode"];
  moderators: ModeratorRef[];
}

function deriveDraft(c: ChannelConfig): Draft {
  return {
    description: c.description ?? "",
    tiers: c.tiers,
    minDonation: c.minDonation,
    minDonationWithText: c.minDonationWithText,
    messageMaxLen: c.messageMaxLen,
    nameMode: c.nameMode,
    textShowMode: c.textShowMode,
    moderators: c.moderators,
  };
}

const enc = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `__b${val}` : val));
const eq = (a: unknown, b: unknown) => enc(a) === enc(b);

function buildPatch(draft: Draft, original: ChannelConfig): ConfigPatch {
  const patch: ConfigPatch = {};
  const ds = draft.description.trim();
  if ((ds || undefined) !== (original.description || undefined)) patch.description = ds || undefined;
  if (!eq(draft.tiers, original.tiers)) patch.tiers = draft.tiers;
  if (draft.minDonation !== original.minDonation) patch.minDonation = draft.minDonation;
  if (draft.minDonationWithText !== original.minDonationWithText)
    patch.minDonationWithText = draft.minDonationWithText;
  if (draft.messageMaxLen !== original.messageMaxLen) patch.messageMaxLen = draft.messageMaxLen;
  if (draft.nameMode !== original.nameMode) patch.nameMode = draft.nameMode;
  if (draft.textShowMode !== original.textShowMode) patch.textShowMode = draft.textShowMode;
  if (!eq(draft.moderators, original.moderators)) patch.moderators = draft.moderators;
  return patch;
}

/**
 * USDC amount field: keeps the RAW string (so you can type "0.", "0.5" — otherwise a round-trip through
 * Number→toMicro→fromMicro would eat the decimal point on every keystroke). Emits micro only for a valid number.
 */
function UsdcAmountInput({
  label,
  micro,
  onMicro,
}: {
  label: string;
  micro: bigint;
  onMicro: (v: bigint) => void;
}) {
  const [str, setStr] = useState(String(fromMicro(micro)));
  return (
    <Input
      label={label}
      mono
      inputMode="decimal"
      value={str}
      onChange={(e) => {
        const s = e.target.value;
        setStr(s);
        const n = Number(s);
        if (s.trim() !== "" && Number.isFinite(n) && n >= 0) onMicro(toMicro(n));
      }}
    />
  );
}

/**
 * Realm config editor (description, tiers/thresholds, crown minimums, name/text-display mode, moderators).
 * Self-contained: pulls its own realm (useMyChannel) and config. Used both in the Studio and in the personal
 * space (Customization) — a single source, no duplication.
 */
export function ChannelSettingsEditor({ title = "Realm settings" }: { title?: string }) {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const configQ = useChannelConfig(channelId);
  const config = configQ.data;
  const update = useUpdateConfig(channelId ?? "");

  const [draft, setDraft] = useState<Draft | null>(null);

  // Init/reset the draft on load and after saving (version/updatedAt change).
  useEffect(() => {
    if (config) setDraft(deriveDraft(config));
  }, [config?.version, config?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (myChannelQ.isLoading || configQ.isLoading || !draft) {
    if (!channelId && !myChannelQ.isLoading)
      return (
        <EmptyState
          title="You don't rule a realm yet"
          description="Open your realm to customize it — description, tiers, minimums and moderators live here."
          action={
            <Link
              href="/space?tab=realm-create"
              className="rounded-lg border border-money-dim bg-money-bg/40 px-5 py-2.5 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
            >
              Open a realm
            </Link>
          }
        />
      );
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (configQ.error || !config) {
    return <ErrorState description="Couldn't load the config." onRetry={() => configQ.refetch()} />;
  }

  const patch = buildPatch(draft, config);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Draft>(key: K, val: Draft[K]) =>
    setDraft({ ...draft, [key]: val } as Draft);

  function save() {
    update.mutate(patch, {
      onSuccess: () => toast({ variant: "success", title: "Saved" }),
      onError: (e) => toast({ variant: "error", title: "Save failed", description: String(e) }),
    });
  }

  return (
    <div className="flex flex-col gap-8 pb-24">
      <h1 className="text-display-l text-fg">{title}</h1>

      {/* H1 payout attestation — chain/icp only; pins the payout address by owner signature. */}
      {IS_CHAIN && myChannelQ.data ? <PayoutAttestationSection channel={myChannelQ.data} /> : null}

      <Section title="Realm description">
        <p className="text-small text-fg-muted">
          Your realm name and links come from your{" "}
          <Link href="/space?tab=settings" className="text-info hover:underline">
            profile
          </Link>{" "}
          — one handle and one set of links per person. Here it&apos;s only the realm description (tagline); it&apos;s shown
          on the realm page and moderated as UGC (profanity is fine, illegal content is not).
        </p>
        <Textarea
          label="Description"
          maxLength={CHANNEL_DESC_MAX}
          showCount
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Section>

      <Section title="Tiers and participation thresholds">
        <p className="text-small text-fg-muted">
          Reign accrues at a fixed rate: <span className="mono">1 USDC = 1 Reign</span>. Here you
          set thresholds in Reign — how much is needed for a tier, perks and mini-game access.
        </p>
        <TierEditor value={draft.tiers} onChange={(t) => set("tiers", t)} />
      </Section>

      <Section title="Crowns">
        <div className="grid gap-4 sm:grid-cols-2">
          <UsdcAmountInput
            label="Minimum crown, USDC"
            micro={draft.minDonation}
            onMicro={(v) => set("minDonation", v)}
          />
          <UsdcAmountInput
            label="Minimum crown with text, USDC"
            micro={draft.minDonationWithText}
            onMicro={(v) => set("minDonationWithText", v)}
          />
        </div>
      </Section>

      <Section title="Text messages">
        <label className="flex flex-col gap-2">
          <span className="text-small text-fg-muted">Character limit</span>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={20}
              max={500}
              step={10}
              value={draft.messageMaxLen}
              onChange={(e) => set("messageMaxLen", Number(e.target.value))}
              aria-label="Character limit"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-pill bg-surface-raised accent-[var(--money)]"
            />
            <span className="mono w-16 shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-center text-small text-fg">
              {draft.messageMaxLen}
            </span>
          </div>
          <span className="text-caption text-fg-faint">Number of characters allowed in a crown message.</span>
        </label>
      </Section>

      <Section title="Audio messages">
        <p className="text-small text-fg-muted">
          Lets your supporters record their own audio with a microphone — an alternative to classic text
          messages.
        </p>
        <p className="text-small text-fg-faint">
          Tip: a well-set minimum crown for audio helps keep unwanted content out.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <Switch checked={false} onCheckedChange={() => {}} disabled label="Enabled" />
          <span className="rounded-pill border border-border px-1.5 text-[10px] uppercase leading-tight tracking-wide text-fg-faint">
            Soon
          </span>
        </div>
      </Section>

      <Section title="Names and text display">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Name mode"
            value={draft.nameMode}
            onChange={(e) => set("nameMode", e.target.value as Draft["nameMode"])}
          >
            <option value="addresses_only">Addresses only</option>
            <option value="allow_display_names">Allow names</option>
          </Select>
          <Select
            label="Text display"
            value={draft.textShowMode}
            onChange={(e) => set("textShowMode", e.target.value as Draft["textShowMode"])}
          >
            <option value="manual">Manual approval</option>
            <option value="auto_if_clean">Auto-show</option>
          </Select>
        </div>
        {draft.textShowMode === "auto_if_clean" ? (
          <p className="text-small text-fg-faint">
            Hard-block categories are never auto-shown.
          </p>
        ) : null}
      </Section>

      <Section title="Moderators">
        <ModeratorEditor value={draft.moderators} onChange={(m) => set("moderators", m)} />
      </Section>

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-raised">
          <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-3">
            <span className="text-small text-fg-muted">Unsaved changes</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(deriveDraft(config))} disabled={update.isPending}>
                Cancel
              </Button>
              <Button variant="money" onClick={save} loading={update.isPending}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-h2 text-fg">{title}</h2>
      {children}
    </section>
  );
}

/**
 * H1 — payout-address attestation. Crowns go straight to this address; the owner's wallet signature pins
 * it, so a donor verifies it before sending and no one (the platform included) can silently swap it.
 * Channels created before attestations pin the address here with one gasless signature.
 */
function PayoutAttestationSection({ channel }: { channel: Channel }) {
  const attest = useAttestPayout();
  const attested = Boolean(channel.payoutAttestation);
  return (
    <Section title="Payout address">
      <div className="flex flex-col gap-3">
        <p className="text-small text-fg-muted">
          Crowns go directly to this address. A wallet signature pins it to you: a donor verifies it
          before sending, and no one (the platform included) can silently swap it.
        </p>
        <span className="mono text-small text-fg">{channel.payoutAddress}</span>
        {attested ? (
          <p className="text-small text-success">
            Verified by the owner&apos;s signature — crowns are open.
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-small text-danger">
              Not verified — crowns to this realm are paused until the address is pinned by signature.
            </p>
            <Button
              variant="money"
              loading={attest.isPending}
              onClick={() =>
                attest.mutate(channel.id, {
                  onSuccess: () => toast({ variant: "success", title: "Payout address verified" }),
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Signature rejected",
                      description: e instanceof Error ? e.message : String(e),
                    }),
                })
              }
            >
              Sign payout address
            </Button>
            <p className="text-small text-fg-faint">
              This is a message signature, not a transaction: no money moves, no gas is spent.
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

// Human-readable moderator-rights labels (the values "queue"/"queue_and_block" are data — leave them alone).
const SCOPE_LABEL: Record<ModeratorRef["scope"], string> = {
  queue: "Queue moderation",
  queue_and_block: "Queue and blocks",
};

export function ModeratorEditor({
  value,
  onChange,
}: {
  value: ModeratorRef[];
  onChange: (m: ModeratorRef[]) => void;
}) {
  const [address, setAddress] = useState("");
  const [scope, setScope] = useState<ModeratorRef["scope"]>("queue");
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <p className="text-small text-fg-faint">No moderators yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {value.map((m, i) => (
            <li
              key={m.address}
              className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2"
            >
              <span className="mono text-small text-fg">{m.address.slice(0, 10)}…</span>
              <span className="text-small text-fg-muted">{SCOPE_LABEL[m.scope]}</span>
              <Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Moderator address" mono value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <Select label="Rights" value={scope} onChange={(e) => setScope(e.target.value as ModeratorRef["scope"])}>
          <option value="queue">{SCOPE_LABEL.queue}</option>
          <option value="queue_and_block">{SCOPE_LABEL.queue_and_block}</option>
        </Select>
        <Button
          variant="secondary"
          onClick={() => {
            if (!isLikelyBase58Address(address.trim())) return;
            onChange([...value, { address: address.trim(), scope }]);
            setAddress("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
