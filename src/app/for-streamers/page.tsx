import Link from "next/link";
import type { Metadata } from "next";
import { CrownLogo } from "@/components/crown-logo";
import { AppHeader } from "@/components/layout/app-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: "For content makers — open your realm · CROWN",
  description:
    "Supporters crown you in USDC on Solana and climb the ranks you set. You keep 97%, straight to your wallet. Non-custodial, free to start.",
};

const CREATE_HREF = "/space?tab=realm-create";

// Money register (design-system §1): the numbers that matter, quiet and exact, in mono.
const FACTS = [
  { figure: "97%", label: "of every crown is yours", accent: true },
  { figure: "3%", label: "flat fee — nothing hidden", accent: false },
  { figure: "$2", label: "one-time to activate your realm", accent: false },
];

const STEPS = [
  {
    n: "1",
    title: "Open your realm",
    body: "Pick a handle, your payout wallet and your ranks. Free on BASIC — one realm per wallet.",
  },
  {
    n: "2",
    title: "Share your link",
    body: "Drop it in stream, in your bio, across socials. Supporters crown you in two clicks.",
  },
  {
    n: "3",
    title: "They crown & climb",
    body: "Every crown is Reign — supporters rise the ranks you set, and keep coming back.",
  },
];

/**
 * Streamer funnel landing (`/for-streamers`) — the discoverable entry point to open a realm (linked from the
 * header nav and footer). Cinematic and minimal: a pure-black hero with the breathing CROWN mark and a single
 * gold-burn CTA, then only what a streamer needs to decide — the money in mono, three steps, one more ask.
 * On-brand: restrained gold on obsidian (design-system.md), one primary action.
 */
export default function ForStreamersPage() {
  return (
    <>
      <AppHeader />
      {/* Atmosphere: a soft gold glow under the header, dissolving into black — the background "breathes". */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-[var(--header-h)] -z-10 h-[620px]"
        style={{
          background:
            "radial-gradient(58% 60% at 50% 0%, rgba(228,179,76,0.14) 0%, rgba(228,179,76,0.04) 40%, transparent 74%)",
        }}
      />

      <main className="mx-auto flex w-full max-w-content flex-col gap-24 px-4 pb-24 pt-16 lg:px-6 lg:pt-24">
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center gap-7 text-center">
          <CrownLogo size={64} className="animate-crown text-money" />

          <span className="rounded-pill border border-money-dim bg-money-bg/50 px-3 py-1 text-caption uppercase tracking-wide text-money">
            For content makers
          </span>

          <h1 className="max-w-3xl text-display-xl leading-[1.05] text-fg">
            Turn your community into <span className="text-status">Reign</span>.
          </h1>

          <p className="max-w-xl text-h3 font-normal text-fg-muted">
            Supporters crown you in USDC on Solana and climb the ranks you set. You keep 97% — straight
            to your wallet.
          </p>

          <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row">
            <Link
              href={CREATE_HREF}
              className="group inline-flex h-12 items-center gap-2 rounded-lg bg-money px-7 text-body font-semibold text-[var(--bg)] shadow-[0_10px_34px_-10px_rgba(228,179,76,0.55)] transition-all duration-200 ease-ease hover:-translate-y-0.5 hover:brightness-110"
            >
              Open your realm
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link
              href="/"
              className="inline-flex h-12 items-center rounded-lg border border-border px-6 text-body text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              Explore realms
            </Link>
          </div>

          <span className="text-caption text-fg-faint">
            Non-custodial · one realm per wallet · free to start
          </span>
        </section>

        {/* ── Money in mono (design-system money register) ─────────────────── */}
        <section aria-label="The economics">
          <dl className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {FACTS.map((f) => (
              <div key={f.figure} className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
                <dt className={`mono text-display-l ${f.accent ? "text-money" : "text-fg"}`}>
                  {f.figure}
                </dt>
                <dd className="text-small text-fg-muted">{f.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-10">
          <h2 className="text-center text-h2 text-fg">Three steps to your first crown</h2>
          <ol className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col items-start gap-3">
                <span
                  className="grid h-11 w-11 place-items-center rounded-full border border-money-dim font-display text-h3 font-semibold text-money"
                  aria-hidden
                >
                  {s.n}
                </span>
                <h3 className="text-h3 text-fg">{s.title}</h3>
                <p className="text-body text-fg-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────────── */}
        <section className="relative flex flex-col items-center gap-6 overflow-hidden rounded-2xl border border-money-dim bg-money-bg/25 px-6 py-16 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64"
            style={{
              background:
                "radial-gradient(50% 100% at 50% 0%, rgba(228,179,76,0.12) 0%, transparent 70%)",
            }}
          />
          <h2 className="max-w-2xl text-h1 text-fg">Your community is already here.</h2>
          <p className="max-w-md text-body text-fg-muted">
            Give it a crown. Open your realm in under a minute — nothing to install, nothing upfront.
          </p>
          <Link
            href={CREATE_HREF}
            className="group inline-flex h-12 items-center gap-2 rounded-lg bg-money px-7 text-body font-semibold text-[var(--bg)] shadow-[0_10px_34px_-10px_rgba(228,179,76,0.55)] transition-all duration-200 ease-ease hover:-translate-y-0.5 hover:brightness-110"
          >
            Open your realm
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
          <span className="text-caption text-fg-faint">
            Non-custodial · money is final · Reign is never for sale.
          </span>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
