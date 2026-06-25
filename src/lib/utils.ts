import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Слияние классов Tailwind с разрешением конфликтов. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// — Единицы денег (frontend/spec.md §4, ADR 0002) —
// Внутри системы деньги — всегда micro-USDC (bigint, 6 знаков). `number`-USDC живёт
// ТОЛЬКО на UI-границе. Конверсия — здесь и нигде больше.

/** USDC (человеческое число) → micro-USDC. Округляет к ближайшему micro (защита от float-дребезга). */
export function toMicro(usdc: number): bigint {
  if (!Number.isFinite(usdc)) throw new Error("toMicro: amount is not finite");
  return BigInt(Math.round(usdc * 1_000_000));
}

/** micro-USDC → USDC (число), только для отображения/графиков. */
export function fromMicro(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

/** micro-USDC → "$12.50" (моно, tabular-nums применяется классом на элементе). */
export function formatUSDC(micro: bigint): string {
  return fromMicro(micro).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** micro-USDC → "$21.3K" (компактно, для плиток-статов и осей графика). */
export function formatUSDCCompact(micro: bigint): string {
  return fromMicro(micro).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

/** Очки репутации → "5,000". */
export function formatPoints(points: number): string {
  return Math.round(points).toLocaleString("en-US");
}

/**
 * Русская плюрализация по числу. forms = [одна, две-четыре, пять]:
 *   plural(1,  f) → f[0] («1 донат»);  21, 31 → тоже f[0]
 *   plural(2,  f) → f[1] («2 доната»); 22–24 → тоже f[1]
 *   plural(5,  f) → f[2] («5 донатов»); 0, 11–14 → тоже f[2]
 * Единый источник правды для всех «N донатов/донатеров/каналов/очков» в UI.
 */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Число + согласованное слово: pluralize(22, ["донат","доната","донатов"]) → "22 доната". */
export function pluralize(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  return `${n} ${plural(n, forms)}`;
}

/** Адрес → "7xKp…3fQa" (усечённо). */
export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Стабильный оттенок (0–359) из строки — для монограммы канала (одинаков в карточке и в шапке канала). */
export function channelHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Дешёвая проверка формата Solana-адреса БЕЗ web3.js (чтобы не тащить Solana-стек в bundle mock/api).
 * Защищает денежный путь от мусорного payout/адреса (иначе `new PublicKey()` падает на хот-пути).
 * Это не валидация кривой ed25519 — авторитетную проверку делает сервер (PublicKey) при аутентификации.
 */
export function isLikelyBase58Address(s: unknown): s is string {
  return typeof s === "string" && s.length >= 32 && s.length <= 44 && BASE58_ALPHABET.test(s);
}

/** Относительное время («3 мин назад»). Только для отображения; абсолютное — в тултипе. */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}
