/**
 * Серверные runtime-флаги (НЕ NEXT_PUBLIC — недоступны клиенту, не подделать из браузера). Единая точка
 * истины для C1-гейта (route) и M2-зачёта по finalized (ingest), чтобы формула chain-режима не дублировалась.
 */
import { IS_PROD } from "@/lib/chain/addresses"; // единый источник prod-гейта (без дубля формулы)

export { IS_PROD };

// Явный серверный chain-режим. Fail-safe: в production включён ПО УМОЛЧАНИЮ, пока не задан CHAIN_MODE=off.
// on → оффчейн-симуляция доната запрещена (C1) и зачёт ждёт finalized, а не confirmed (M2, защита от реорга).
export const CHAIN_MODE =
  process.env.CHAIN_MODE === "on" || (IS_PROD && process.env.CHAIN_MODE !== "off");
