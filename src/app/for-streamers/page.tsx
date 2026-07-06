import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For streamers — open your realm · CROWN",
  description:
    "Turn your community into Reign. Supporters crown you in USDC on Solana and earn reputation inside your realm — you set the tiers, 97% goes straight to you.",
};

const CREATE_HREF = "/space?tab=realm-create";

const VALUES = [
  {
    title: "You set the tiers",
    body: "Your realm, your ladder. Name the ranks, pick the thresholds and colors — supporters climb the statuses you define, not a global one.",
  },
  {
    title: "97% goes to you",
    body: "Crowns land in your payout wallet directly — non-custodial, no middleman holding the money. A flat 3% protocol fee, nothing hidden.",
  },
  {
    title: "Reputation that's local",
    body: "Reign is earned in your community and can't be bought, sold or transferred. It's yours to grow — a reason for supporters to keep coming back.",
  },
  {
    title: "Moderation built in",
    body: "Crown text is private until you show it. Hold, hide or auto-clear messages; block wallets. You decide what goes public on your realm.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Create your realm",
    body: "Pick a handle, your payout address and your tier ladder. Free on BASIC status — one realm per wallet.",
  },
  {
    n: "2",
    title: "Share the link",
    body: "Drop your realm link in stream, bio and socials. Supporters open it and crown you in a couple of clicks.",
  },
  {
    n: "3",
    title: "They crown & climb",
    body: "Every crown earns Reign and moves supporters up your tiers. You watch it grow in your realm dashboard.",
  },
];

/**
 * Streamer funnel landing (`/for-streamers`). The entry point a new streamer can actually find (linked from
 * the header nav and footer) — explains the value and routes to the create-realm wizard. A guest hitting the
 * CTA lands on the wallet-connect prompt in /space, then the wizard. On-brand: restrained gold on obsidian.
 */
export default function ForStreamersPage() {
  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-20 px-4 py-14 lg:px-6 lg:py-20">
      {/* Hero */}
      <section className="flex flex-col items-start gap-6">
        <span className="rounded-pill border border-money-dim bg-money-bg/40 px-3 py-1 text-caption uppercase tracking-wide text-money">
          For streamers
        </span>
        <h1 className="max-w-3xl text-display-l text-fg">
          Turn your community into <span className="text-status">Reign</span>.
        </h1>
        <p className="max-w-2xl text-h3 font-normal text-fg-muted">
          Supporters crown you in USDC on Solana and earn reputation inside your realm — reputation you
          shape, that&apos;s earned and never bought or sold.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href={CREATE_HREF}
            className="inline-flex h-11 items-center rounded-lg bg-money px-6 text-body font-semibold text-black transition-opacity hover:opacity-90"
          >
            Open your realm →
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-body text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            Explore realms
          </Link>
        </div>
      </section>

      {/* Value props */}
      <section className="flex flex-col gap-6">
        <h2 className="text-h2 text-fg">Why open a realm</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
              <h3 className="text-h3 text-fg">{v.title}</h3>
              <p className="text-body text-fg-muted">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-6">
        <h2 className="text-h2 text-fg">How it works</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <span
                className="grid h-9 w-9 place-items-center rounded-full border border-money-dim font-display text-body font-semibold text-money"
                aria-hidden
              >
                {s.n}
              </span>
              <h3 className="text-h3 text-fg">{s.title}</h3>
              <p className="text-body text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="text-small text-fg-faint">
          A realm starts free on <span className="mono">BASIC</span>. Activation later unlocks
          crowns-with-text and public indexing — but supporters can crown you and earn Reign from day one.
        </p>
      </section>

      {/* Closing CTA */}
      <section className="flex flex-col items-center gap-5 rounded-xl border border-money-dim bg-money-bg/20 px-6 py-12 text-center">
        <h2 className="max-w-2xl text-h1 text-fg">Your community is already here. Give it a crown.</h2>
        <Link
          href={CREATE_HREF}
          className="inline-flex h-12 items-center rounded-lg bg-money px-7 text-body font-semibold text-black transition-opacity hover:opacity-90"
        >
          Open your realm →
        </Link>
        <span className="text-caption text-fg-faint">
          Non-custodial · money is final · Reign is never for sale.
        </span>
      </section>
    </div>
  );
}
