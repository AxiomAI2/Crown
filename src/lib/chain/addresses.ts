/**
 * Ончейн-адреса и константы СТРОКАМИ (без web3.js), чтобы их мог импортировать серверный стор, не таща
 * Solana-стек в bundle mock/api. PublicKey-обёртки и Memo-программа — в config.ts.
 */
export const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";

export const USDC_DECIMALS = 6;
export const FEE_BPS = 300; // 3%

/** Одноразовый сбор активации канала (~$2 в трежери), анти-флуд-якорь (core-spec §3/§9). */
export const ACTIVATION_FEE_USDC = 2;
export const ACTIVATION_FEE_MICRO = BigInt(ACTIVATION_FEE_USDC) * 1_000_000n;

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Единая точка истины для prod-гейта (реэкспортируется из @/server/runtime). */
export const IS_PROD = process.env.NODE_ENV === "production";

// Известные devnet-дефолты (адрес трежери + Circle devnet USDC). Их происхождение/секрет публичны
// (.treasury-devnet.json, faucet), поэтому на mainnet они ЗАПРЕЩЕНЫ: использовать devnet-трежери в проде =
// слать 3%-комиссию на адрес, чей приватный ключ лежит в плейнтекст-файле. В проде дефолт НЕ применяется —
// значения обязаны прийти из env, иначе денежный путь падает (fail-closed, ADR 0009 / аудит C2).
const DEVNET_TREASURY = "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Devnet-дефолт применяется только вне прода; в проде → "" (env обязателен). */
const devnetOnly = (v: string): string => (IS_PROD ? "" : v);

/** Circle devnet USDC (faucet.circle.com). На mainnet задать mainnet-USDC-mint через env. */
export const DEVNET_USDC_MINT = process.env.NEXT_PUBLIC_DEVNET_USDC_MINT ?? devnetOnly(DEVNET_USDC);

/** Трежери (владелец) — получает 3%. Devnet-дефолт gitignored в .treasury-devnet.json; в проде — env. */
export const TREASURY_OWNER = process.env.NEXT_PUBLIC_TREASURY_OWNER ?? devnetOnly(DEVNET_TREASURY);

/** Адрес оператора (/ops). Вне прода удобный дефолт = трежери; в проде НЕ наследует (одноключевой риск). */
export const OPERATOR_ADDRESS =
  process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? devnetOnly(TREASURY_OWNER);

/**
 * Fail-closed валидация денежной конфигурации на mainnet (аудит C2). Вне прода — no-op (devnet-дефолты ок).
 * В проде требует явные трежери/оператор/USDC-mint, запрещает devnet-трежери и совпадение оператор=трежери
 * (одноключевой риск, ADR 0006). Зовётся при старте сервера (instrumentation) и на денежном пути (ingest).
 */
export function assertMoneyConfig(): void {
  if (!IS_PROD) return;
  const missing: string[] = [];
  if (!TREASURY_OWNER) missing.push("NEXT_PUBLIC_TREASURY_OWNER");
  if (!OPERATOR_ADDRESS) missing.push("NEXT_PUBLIC_OPERATOR_ADDRESS");
  if (!DEVNET_USDC_MINT) missing.push("NEXT_PUBLIC_DEVNET_USDC_MINT (USDC mint)");
  if (missing.length > 0) {
    throw new Error(
      `[C2] В production не заданы обязательные деньги-переменные: ${missing.join(", ")}. ` +
        "Devnet-дефолты в проде запрещены (ключ трежери — в плейнтексте). Задай env перед mainnet.",
    );
  }
  if (TREASURY_OWNER === DEVNET_TREASURY) {
    throw new Error(
      "[C2] На mainnet задан DEVNET-трежери (ключ в плейнтексте). Сгенерируй свежий mainnet-ключ.",
    );
  }
  if (TREASURY_OWNER === OPERATOR_ADDRESS) {
    throw new Error(
      "[C2] OPERATOR_ADDRESS == TREASURY_OWNER в production — разведи роли (одноключевой риск, ADR 0006).",
    );
  }
}
