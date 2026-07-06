import Link from "next/link";
import { CrownLogo } from "@/components/crown-logo";

/**
 * Глобальный футер CROWN. Мягкое золото — только логотип; ссылки нейтральные (text-fg-faint → hover text-fg).
 * Ненастроенные разделы честно помечены «Soon» (инвариант §7: без кнопок-обманок — явный disabled-state).
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 lg:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
          {/* Бренд */}
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-3 lg:col-span-2">
            <Link href="/" className="flex items-center gap-2.5" aria-label="CROWN — home">
              <CrownLogo size={26} className="text-[#c9a24a]" />
              <span className="font-display text-lg font-semibold tracking-[0.22em] text-fg">
                CROWN
              </span>
            </Link>
            <p className="max-w-xs text-small text-fg-faint">
              Crown a streamer with USDC on Solana and build your Reign in their realm — earned, non-transferable.
            </p>
          </div>

          <FooterCol title="Product">
            <FooterLink href="/">Realms</FooterLink>
            <FooterLink href="/games">Mini-games</FooterLink>
          </FooterCol>

          <FooterCol title="Legal">
            <Soon>Privacy Policy</Soon>
            <Soon>Terms of Service</Soon>
          </FooterCol>

          <FooterCol title="Resources">
            <Soon>Coming soon</Soon>
          </FooterCol>

          <FooterCol title="Company">
            <Soon>About</Soon>
            <Soon>Contact us</Soon>
          </FooterCol>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-caption text-fg-faint">© 2026 CROWN</span>
          <span className="text-caption text-fg-faint">
            Non-custodial · money is final · Reign is never for sale.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-caption uppercase tracking-wide text-fg-faint">{title}</h3>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-small text-fg-muted transition-colors hover:text-fg">
        {children}
      </Link>
    </li>
  );
}

/** Ненастроенный пункт — честный disabled-state с меткой «Soon» вместо кнопки-обманки. */
function Soon({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <span className="inline-flex cursor-default items-center gap-1.5 text-small text-fg-faint" title="Coming soon">
        {children}
        <span className="rounded-pill border border-border px-1.5 text-[10px] uppercase leading-tight tracking-wide text-fg-faint">
          Soon
        </span>
      </span>
    </li>
  );
}
