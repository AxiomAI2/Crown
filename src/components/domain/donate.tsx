"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Amount, FeeSplit } from "./amount";
import { StandingHeadline, TierBadge } from "./standing";
import { CrownLogo } from "@/components/crown-logo";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDonate, useMyBlock } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { cn, formatPoints, toMicro } from "@/lib/utils";
import type {
  Channel,
  ChannelConfig,
  DonationResult,
  Session,
  ViewerStanding,
} from "@/lib/data/types";

const PRESETS = [5, 10, 25, 100];
const SOFT_WORDS = ["worst", "loser", "scam", "idiot"];

const USDC_DECIMALS = 6; // USDC precision: there are no more decimal places than this in micro-USDC
// Cap on a single crown. Guards against three "out of bounds" cases at once: pointlessly huge amounts,
// layout overflow (the number spills out of the card) and precision loss in toMicro (usdc*1e6 past Number.MAX).
const MAX_DONATION_USDC = 1_000_000;
const MAX_INT_DIGITS = String(MAX_DONATION_USDC).length; // integer part length is capped → can't type "infinity"

/**
 * Amount-field sanitizer: digits and ONE dot only (comma → dot for RU keyboard layout), integer part no longer
 * than MAX_INT_DIGITS, fractional part no longer than 6 digits. Otherwise extra digits would round in toMicro and
 * cause "oddities" (e.g. 0.0000001 → 0), and a long integer would spill out of the card and lose precision.
 */
function sanitizeAmount(raw: string): string {
  const s = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s.slice(0, MAX_INT_DIGITS);
  const int = s.slice(0, dot).slice(0, MAX_INT_DIGITS);
  const frac = s.slice(dot + 1).replace(/\./g, ""); // drop repeated dots
  return `${int}.${frac.slice(0, USDC_DECIMALS)}`;
}

export function DonateWidget({
  channel,
  config,
  session,
  standing,
  standingLoading,
}: {
  channel: Channel;
  config: ChannelConfig;
  session: Session;
  standing?: ViewerStanding | null;
  standingLoading?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [withText, setWithText] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DonationResult | null>(null);
  const [blockDismissed, setBlockDismissed] = useState(false);
  // Captured at confirm time: did the sent crown carry a message? The success view's "message HELD" notice reads
  // this, not live `withText` — onSuccess clears the form (withText → false), so a live read would always be false.
  const [sentHadText, setSentHadText] = useState(false);
  const donate = useDonate(channel.id);
  // Whether the donor is blocked on this realm (for the banner): my block + reason.
  const myBlock = useMyBlock(channel.id, session.address).data;
  // The wallet's USDC balance is put in the cache by HeaderBalance (chain mode). Here we only SUBSCRIBE to the
  // same key (enabled:false — we don't send our own request). In mock/api there's no key → balance stays
  // undefined and the check doesn't apply. We don't pull wallet-adapter into the shared bundle.
  const balanceQ = useQuery<number>({
    queryKey: ["usdcBalance", session.address ?? ""],
    queryFn: () => new Promise<number>(() => {}), // never called (enabled:false)
    enabled: false,
  });

  const connected = Boolean(session.address);
  // Streamer's page-theme accent (Customization → Page): tints the Crown CTA + the selected preset. Undefined → default.
  const accent = config.pageTheme?.accent;
  const accentStyle = accent ? { background: accent, borderColor: accent, color: "#0d0d0d" } : undefined;
  const isBasic = channel.status === "BASIC";
  const amountNum = Number(amount);
  const amountPositive = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const overMax = amountPositive && amountNum > MAX_DONATION_USDC;
  const amountValid = amountPositive && !overMax;
  const min = withText ? config.minDonationWithText : config.minDonation;
  const micro = amountValid ? toMicro(amountNum) : 0n;
  const meetsMin = amountValid && micro >= min;
  const textOk = !withText || text.trim().length > 0;
  // Whether there's enough USDC in the wallet (chain only — where balance is known). amountNum and balance are both in USDC.
  const balance = session.address ? balanceQ.data : undefined;
  const insufficient = balance != null && amountValid && amountNum > balance;
  // A blocked donor can't crown WITH a message (the server rejects it). Gate it HERE so the block is caught before
  // the confirm/sign step instead of after the signature; crowning without text stays allowed (see the banner).
  const blockedFromText = withText && !!myBlock;
  const canDonate =
    connected &&
    amountValid &&
    meetsMin &&
    textOk &&
    !(withText && isBasic) &&
    !blockedFromText &&
    !insufficient;
  const softWarn = withText && SOFT_WORDS.some((w) => text.toLowerCase().includes(w));
  const amountError = overMax
    ? `Max ${formatPoints(MAX_DONATION_USDC)} USDC per crown`
    : amountPositive && !meetsMin
      ? `Below realm minimum — ${Number(min) / 1_000_000} USDC`
      : insufficient
        ? "Not enough USDC in wallet"
        : undefined;

  // Projected gain for the entered amount (same formula as the real crediting) — for the preview.
  const gain = amountValid ? pointsForAmount(micro) : 0;

  function openFlow() {
    setResult(null);
    donate.reset();
    setOpen(true);
  }
  function confirm() {
    const hadText = withText; // capture before onSuccess resets the form (below) — the success view reads this
    donate.mutate(
      { amountUSDC: amountNum, text: withText ? text.trim() : undefined },
      {
        onSuccess: (r) => {
          setResult(r);
          setSentHadText(hadText);
          // Crown sent → clear the form right away (especially the message text) so it doesn't linger in the field.
          setAmount("");
          setText("");
          setWithText(false);
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Crown failed",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
      {!connected ? (
        <>
          <h3 className="text-h3 text-fg">Crown</h3>
          <p className="text-small text-fg-muted">
            Connect your wallet to crown this realm and build your Reign.
          </p>
          <ConnectWalletButton />
        </>
      ) : (
        <>
      {/* Banner for a blocked donor: why and what they're blocked from; the cross hides it. */}
      {myBlock && !blockDismissed ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-bg p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-small font-medium text-danger">
              You&apos;re blocked on this realm
            </span>
            <span className="text-small text-fg-muted">
              Crowns with a message won&apos;t go through
              {myBlock.reason ? <> · reason: {myBlock.reason}</> : null}. You can still crown without text.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setBlockDismissed(true)}
            className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* My Reign + live preview: enter an amount → the number rolls toward the projection, the bar stretches. */}
      <StandingHeadline standing={standing} tiers={config.tiers} gain={gain} loading={standingLoading} />

      <div className="border-t border-border" />

      <h3 className="text-h3 text-fg">Crown</h3>

      <div className="flex flex-col gap-2">
        <Input
          label="Amount, USDC"
          mono
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
          onKeyDown={(e) => {
            // Enter submits (opens confirm) when the amount is valid — the main flow shouldn't require the mouse.
            if (e.key === "Enter" && canDonate) {
              e.preventDefault();
              openFlow();
            }
          }}
          error={amountError}
          className="bg-[var(--bg)]"
        />
        {balance != null ? (
          <div className="flex items-center justify-between text-caption text-fg-faint">
            <span>
              Balance: <span className="mono text-fg-muted">{balance.toFixed(2)}</span> USDC
            </span>
            <button
              type="button"
              onClick={() => setAmount(sanitizeAmount(String(balance)))}
              className="rounded px-1 text-fg-muted transition-colors hover:text-fg"
            >
              Max
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => {
            const selected = amount !== "" && amountNum === p;
            return (
              <Button
                key={p}
                variant={selected ? "primary" : "secondary"}
                size="sm"
                aria-pressed={selected}
                className={cn("w-full", !selected && "bg-[var(--bg)]")}
                style={selected ? accentStyle : undefined}
                onClick={() => setAmount(String(p))}
              >
                ${p}
              </Button>
            );
          })}
        </div>
      </div>

      {isBasic ? (
        <p className="rounded border border-border bg-surface-raised p-3 text-small text-fg-muted">
          This realm isn&apos;t activated — crowning with a message isn&apos;t available yet. You can still crown without text.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-small text-fg-muted">
            <input
              type="checkbox"
              checked={withText}
              onChange={(e) => setWithText(e.target.checked)}
            />
            Add a message
          </label>

          {withText ? (
            <Textarea
              label="Message"
              placeholder="Message to attach…"
              maxLength={config.messageMaxLen}
              showCount
              value={text}
              onChange={(e) => setText(e.target.value)}
              helper={
                blockedFromText
                  ? "You're blocked from messages on this realm — uncheck to crown without text."
                  : softWarn
                    ? "This contains a word the content maker's filter may flag (doesn't block)."
                    : "Text stays private until shown — the content maker decides whether to publish it."
              }
              className={cn(
                "bg-[var(--bg)]",
                softWarn && "border-warn",
                blockedFromText && "border-danger",
              )}
            />
          ) : null}
        </>
      )}

      {amountValid ? <FeeSplit amount={micro} /> : null}

      <Button
        variant="secondary"
        disabled={!canDonate}
        onClick={openFlow}
        className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
        style={accentStyle}
      >
        Crown
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // after a successful crown, clear the form on close
          if (!o && result) {
            setAmount("");
            setText("");
            setWithText(false);
            setResult(null);
          }
        }}
      >
        <DialogContent>
          {result ? (
            <DoneView result={result} hadText={sentHadText} onClose={() => setOpen(false)} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirm crown</DialogTitle>
                <DialogDescription>
                  Crowning <span className="mono text-fg">@{channel.handle}</span> · crowns are final, no
                  refunds.
                </DialogDescription>
              </DialogHeader>
              <FeeSplit amount={micro} />
              {withText ? (
                <div className="flex flex-col gap-1">
                  <span className="text-caption uppercase tracking-wide text-fg-faint">Your message</span>
                  <p className="whitespace-pre-wrap break-words rounded border border-border bg-surface p-3 text-small text-fg">
                    {text.trim()}
                  </p>
                </div>
              ) : null}
              {donate.isPending ? (
                <p className="text-small text-fg-muted">
                  Sign in your wallet and wait for on-chain finality (~15–30s) — “Done” appears once the crown
                  becomes irreversible.
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={donate.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="money" loading={donate.isPending} onClick={confirm}>
                  {donate.isPending ? "Finalizing…" : "Confirm & sign"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}

/** Crown finality — the signature moment. The PAYOFF is Reign earned: the reward is the hero (big, formatted),
 *  not the fee split (already shown in the preview + confirm). Money is one quiet line for transparency. */
export function FinalityMoment({ result }: { result: DonationResult }) {
  const gain = pointsForAmount(result.donation.amount);
  return (
    <div className="animate-stamp flex flex-col items-center gap-3 rounded-lg border border-money bg-money-bg p-6 text-center">
      <span className="leading-none text-money" aria-hidden>
        <CrownLogo size={40} />
      </span>
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[2.75rem] font-semibold leading-none text-money">
          +{formatPoints(gain)}
        </span>
        <span className="text-caption uppercase tracking-wide text-status">Reign earned</span>
      </div>
      <p className="text-small text-fg-muted">
        You now hold <span className="mono text-fg">{formatPoints(result.standing.points)}</span> Reign in this realm.
      </p>
      <p className="text-caption text-fg-faint">
        <Amount micro={result.donation.netToStreamer} /> reached the streamer · funds are final.
      </p>
    </div>
  );
}

function DoneView({
  result,
  hadText,
  onClose,
}: {
  result: DonationResult;
  hadText: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Crown sent</DialogTitle>
        <DialogDescription>Funds are final. Your Reign is already counted.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <FinalityMoment result={result} />
        {result.tierChanged && result.standing.tier ? (
          <div
            className="animate-stamp flex items-center justify-center gap-2 rounded-lg border-2 p-3"
            style={{ borderColor: result.standing.tier.color }}
          >
            <span className="text-small text-fg-muted">New tier!</span>
            <TierBadge tier={result.standing.tier} />
          </div>
        ) : null}
        {hadText ? (
          <p className="rounded border border-border bg-surface p-3 text-small text-fg-muted">
            Your message is with the content maker for review (HELD). Funds and Reign are already counted —
            publishing the text doesn&apos;t affect them.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
