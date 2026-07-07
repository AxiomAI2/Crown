import type { Metadata } from "next";
// Fonts via next/font (display: swap). CROWN: ONE font for the whole UI — Inter (headings and text).
// Mono (JetBrains) — only for numbers/amounts/addresses (tabular-nums). No decorative serifs.
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const body = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CROWN — crown your realm",
  description:
    "Crown a content maker with USDC on Solana and build your Reign in their realm. Non-transferable, earned crown by crown.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <div className="flex min-h-screen flex-col">
          {/* animate-enter — a soft fade-in on the FIRST arrival at the site (the layout does not remount →
              just once; page-to-page transitions are handled by template.tsx). opacity only — safe
              for the sticky header / fixed elements. */}
          <div className="flex-1 animate-enter">
            <Providers>{children}</Providers>
          </div>
        </div>
      </body>
    </html>
  );
}
