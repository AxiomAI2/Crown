import { clsx, type ClassValue } from "clsx";
import type { CSSProperties } from "react";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// — Money units (docs/design-system.md, ADR 0002) —
// Inside the system money is always micro-USDC (bigint, 6 digits). `number`-USDC lives
// ONLY at the UI boundary. Conversion — here and nowhere else.

/** USDC (human number) → micro-USDC. Rounds to the nearest micro (protection against float jitter). */
export function toMicro(usdc: number): bigint {
  if (!Number.isFinite(usdc)) throw new Error("toMicro: amount is not finite");
  return BigInt(Math.round(usdc * 1_000_000));
}

/** micro-USDC → USDC (number), only for display/charts. */
export function fromMicro(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

/** Dollar number → "$12.50". The single currency formatter (for already-USDC numbers: chart axes etc.). */
export function formatUSDCNumber(usd: number): string {
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** micro-USDC → "$12.50" (mono, tabular-nums applied by a class on the element). */
export function formatUSDC(micro: bigint): string {
  return formatUSDCNumber(fromMicro(micro));
}

/** Reign points (fractional, 1:1 to USDC) → "5,000", "2.5", "2.53". Up to 2 digits, trailing zeros dropped. */
export function formatPoints(points: number): string {
  return points.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Points → full format up to a million, then compact ("1.2M") — so large numbers don't overflow the frame. */
export function formatPointsCompact(points: number): string {
  return Math.abs(points) >= 1_000_000
    ? points.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })
    : points.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Russian pluralization by number. forms = [one, two-to-four, five]:
 *   plural(1,  f) → f[0] ("1 crown");  21, 31 → also f[0]
 *   plural(2,  f) → f[1] ("2 crowns"); 22–24 → also f[1]
 *   plural(5,  f) → f[2] ("5 crowns"); 0, 11–14 → also f[2]
 * The single source of truth for all "N crowns/supporters/realms/points" in the UI.
 */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Collapses any runs of spaces/newlines into a single space (+ trim). Only for DISPLAYING a crown: otherwise
 * "space/newline flood" (each character within the limit) stretches the card across half the screen. The content
 * in the store and moderation (hash, verdict) stays original — this is a purely visual normalization.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Address → "7xKp…3fQa" (truncated). */
export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Stable hue (0–359) from a string — for a realm's monogram (identical in the card and in the realm header). */
export function channelHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Fill a donations-list row template: {username} {amount} {message} → values (unknown tags left as-is).
 *  Shared by the OBS list overlay and the builder preview. */
export function renderRowTemplate(
  tpl: string,
  vars: { username: string; amount: string; message: string },
): string {
  return tpl.replace(/\{(username|amount|message)\}/g, (_m, k: keyof typeof vars) => vars[k] ?? "");
}

/** Turn a realm's PageTheme into inline CSS for the public card (+ `--realm-accent` var). Shared by the public
 *  realm page and the builder's live preview so they render identically. Undefined theme → no override. */
export function pageThemeStyle(theme?: {
  bgType?: "color" | "gradient" | "image";
  bgColor?: string;
  bgGradient?: string;
  bgImage?: string;
  bgFill?: "cover" | "repeat";
  accent?: string;
}): CSSProperties {
  if (!theme) return {};
  const s: CSSProperties & Record<string, string | undefined> = {};
  if (theme.bgType === "color" && theme.bgColor) s.background = theme.bgColor;
  else if (theme.bgType === "gradient" && theme.bgGradient) s.background = theme.bgGradient;
  else if (theme.bgType === "image" && theme.bgImage) {
    s.backgroundImage = `url("${theme.bgImage.replace(/"/g, "%22")}")`;
    if (theme.bgFill === "repeat") {
      s.backgroundRepeat = "repeat";
      s.backgroundSize = "auto";
    } else {
      s.backgroundRepeat = "no-repeat";
      s.backgroundSize = "cover";
      s.backgroundPosition = "center";
    }
  }
  if (theme.accent) s["--realm-accent"] = theme.accent;
  return s;
}

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * A cheap check of a Solana address format WITHOUT web3.js (to avoid dragging the Solana stack into the mock/api bundle).
 * Protects the money path from a garbage payout/address (otherwise `new PublicKey()` fails on the hot path).
 * This is not ed25519 curve validation — the authoritative check is done by the server (PublicKey) during authentication.
 */
export function isLikelyBase58Address(s: unknown): s is string {
  return typeof s === "string" && s.length >= 32 && s.length <= 44 && BASE58_ALPHABET.test(s);
}

/** Relative time ("3 min ago"). Only for display; the absolute time — in the tooltip. */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}
