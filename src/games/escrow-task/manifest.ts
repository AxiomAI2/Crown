import type { GameModule } from "../types";

/**
 * Манифест первой мини-игры — «задание-донат с проверкой комьюнити». Полная спека —
 * `yellow-paper §7`, шов с ядром репутации — ADR 0015. Статус `available`:
 * канал включает игру тумблером в студии (enabledGames).
 */
export const escrowTask: GameModule = {
  id: "escrow-task",
  title: "Задания за донат",
  tagline:
    "Донат с заданием в эскроу: стример выполняет, комьюнити проверяет, иначе — возврат донору.",
  status: "available",
  specDoc: "docs/yellow-paper.md",
};
