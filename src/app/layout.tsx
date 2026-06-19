import type { Metadata } from "next";
// Шрифты грузим через next/font (design-system.md §8, display: swap).
// Design-target — General Sans (Fontshare) для display; на Фазе 0 берём Cyrillic-capable
// замены из Google Fonts, т.к. UI-копирайт русский (Hanken Grotesk без кириллицы).
import { Manrope, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const display = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-display",
  display: "swap",
});
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
  title: "Standing",
  description: "Локальная репутация как продукт. Донаты в USDC на Solana → статус в комьюнити стримера.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`dark ${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
