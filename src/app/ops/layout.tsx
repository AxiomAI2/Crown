import Link from "next/link";

/** Отдельный admin-хром для консоли оператора (yellow-paper §14). */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border-strong bg-danger-bg">
        <div className="mx-auto flex max-w-content items-center justify-between px-4 py-3">
          <Link href="/ops" className="font-display text-h3 text-fg">
            Standing · T&amp;S
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-small text-fg-muted hover:text-fg">
              На платформу
            </Link>
            <span className="mono text-caption text-fg-faint">консоль оператора</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-content px-4 py-8">{children}</main>
    </>
  );
}
