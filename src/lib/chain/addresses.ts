/**
 * Ончейн-адреса и константы СТРОКАМИ (без web3.js), чтобы их мог импортировать серверный стор, не таща
 * Solana-стек в bundle mock/api. PublicKey-обёртки и Memo-программа — в config.ts.
 */
export const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";

/** Кластер для ссылок на эксплорер — выводим из RPC-эндпоинта (по умолчанию devnet). */
export const EXPLORER_CLUSTER = DEVNET_RPC.includes("devnet")
  ? "devnet"
  : DEVNET_RPC.includes("testnet")
    ? "testnet"
    : "mainnet-beta";

/** Ссылка на транзакцию в Solana Explorer (с нужным кластером). Строкой — без web3.js, импортится из UI. */
export function explorerTxUrl(signature: string): string {
  const url = `https://explorer.solana.com/tx/${signature}`;
  return EXPLORER_CLUSTER === "mainnet-beta" ? url : `${url}?cluster=${EXPLORER_CLUSTER}`;
}

/** Ссылка на адрес (аккаунт) в Solana Explorer — для «открыть payout канала в проводнике». */
export function explorerAddressUrl(address: string): string {
  const url = `https://explorer.solana.com/address/${address}`;
  return EXPLORER_CLUSTER === "mainnet-beta" ? url : `${url}?cluster=${EXPLORER_CLUSTER}`;
}

export const USDC_DECIMALS = 6;
export const FEE_BPS = 300; // 3%

/**
 * Целочисленное расщепление суммы доната: fee = FEE_BPS, net = остаток. ЕДИНЫЙ источник правды о ставке
 * (web3-free, поэтому зовётся и из mock/api, и из UI, и из chain-пути) — не дублировать `*3n/100n` по месту.
 */
export function splitAmount(amountMicro: bigint): { fee: bigint; net: bigint } {
  const fee = (amountMicro * BigInt(FEE_BPS)) / 10_000n;
  return { fee, net: amountMicro - fee };
}

/** Одноразовый сбор активации канала (~$2 в трежери), анти-флуд-якорь (core-spec §3/§9). */
const ACTIVATION_FEE_USDC = 2;
export const ACTIVATION_FEE_MICRO = BigInt(ACTIVATION_FEE_USDC) * 1_000_000n;

/** Единая точка истины для prod-гейта (реэкспортируется из @/server/runtime). */
export const IS_PROD = process.env.NODE_ENV === "production";

/** Chain-режим (NEXT_PUBLIC_DATA_SOURCE=chain) — единый клиентский флаг (как IS_PROD), не дублировать по месту. */
export const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

/** Ключ localStorage для SIWS-токена (пишет chain-provider, читает /dev/db). Один источник — не дублировать. */
export const SIWS_STORAGE_KEY = "standing.siws.v1";

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

// — Эскроу-программа задания-доната (игра, G3a; ADR 0017). На devnet — задеплоенный id; в проде env. —
const DEVNET_ESCROW_PROGRAM = "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4";
// ОБЯЗАН совпадать с RESOLVER-константой в anchor/programs/escrow-task/src/lib.rs — иначе подписанные
// resolve_dispute/mark_disputed отвергаются программой (ровно эта рассинхронизация и была: дефолт тянулся
// от OPERATOR_ADDRESS = трежери, а программа ждёт другой ключ).
const DEVNET_ESCROW_RESOLVER = "6F5Y3qLdDCB7gm1hFwdangodbRjWJRhnvNSxgPofB5xR";
/** Program id эскроу-программы. На mainnet задать свежий задеплоенный id через env. */
export const ESCROW_PROGRAM_ID =
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? devnetOnly(DEVNET_ESCROW_PROGRAM);
/**
 * Bounded-резолвер спора (G3a, devnet-only): адрес, которому программа разрешает выбрать сторону спора
 * (украсть/перенаправить не может — получатели зашиты в эскроу). Дефолт = захардкоженный в программе RESOLVER.
 * На мейннете заменяется ончейн-голосованием (G3b) — переменная уйдёт.
 */
export const ESCROW_RESOLVER =
  process.env.NEXT_PUBLIC_ESCROW_RESOLVER ?? devnetOnly(DEVNET_ESCROW_RESOLVER);

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
