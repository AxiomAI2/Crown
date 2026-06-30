/**
 * Разовая чистка (chain-режим): удаляет escrow-task задания БЕЗ ончейн-эскроу — у которых нет
 * `escrowTaskId`, т.е. за ними нет денег (оффчейн-артефакты: создано на старом mock/api или до подхвата
 * нового бандла). Задания с эскроу (escrowTaskId есть) НЕ трогает.
 *
 * Запускать при ОСТАНОВЛЕННОМ сервере (PGlite — однопроцессный):
 *   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"  # не обязателен
 *   npx tsx scripts/prune-moneyless-tasks.ts
 */
import { loadStore, saveStore } from "../src/server/store-db";

(async () => {
  const snap = await loadStore();
  if (!snap) {
    console.log("стор пуст — чистить нечего");
    process.exit(0);
  }
  let removed = 0;
  const gameState = (snap.gameState ?? []).map((entry) => {
    const [gid, slice] = entry as [string, unknown];
    if (gid !== "escrow-task" || !slice || typeof slice !== "object") return entry;
    const s = slice as { tasks?: Array<{ escrowTaskId?: unknown }> };
    if (!Array.isArray(s.tasks)) return entry;
    const kept = s.tasks.filter(
      (t) => typeof t?.escrowTaskId === "string" && t.escrowTaskId.length > 0,
    );
    removed += s.tasks.length - kept.length;
    return [gid, { ...s, tasks: kept }] as [string, unknown];
  });
  await saveStore({ ...snap, gameState });
  console.log(`удалено заданий без эскроу: ${removed}`);
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e?.message ?? e);
  process.exit(1);
});
