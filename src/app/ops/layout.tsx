import Link from "next/link";
import { CrownLogo } from "@/components/crown-logo";

/** Operator console chrome (Trust & Safety). A distinct danger-tinted header marks the high-stakes zone. */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-danger/40 bg-danger-bg">
        <div className="mx-auto flex max-w-content items-center justify-between px-4 py-3">
          <Link href="/ops" className="flex items-center gap-2.5" aria-label="CROWN — Trust & Safety">
            <CrownLogo size={26} className="text-money" />
            <span className="font-display text-h3 tracking-[0.02em] text-fg">
              CROWN&nbsp;·&nbsp;T&amp;S
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-small text-fg-muted transition-colors hover:text-fg">
              To platform
            </Link>
            <span className="mono text-caption text-fg-faint">operator console</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-content px-4 py-8">{children}</main>
    </>
  );
}
