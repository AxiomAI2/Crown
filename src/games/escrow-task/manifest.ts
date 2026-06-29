import type { GameModule } from "../types";

/**
 * Манифест первой мини-игры — «задание-донат с проверкой комьюнити». Логика (стейт-машина на моке),
 * хуки и экраны добавятся рядом в этой папке на фазе G1. Полная спека — `docs/games/escrow-task-spec.md`,
 * шов с ядром репутации — ADR 0015. Пока `building`: каналам к включению не предлагается.
 */
export const escrowTask: GameModule = {
  id: "escrow-task",
  title: "Задания за донат",
  tagline:
    "Донат с заданием в эскроу: стример выполняет, комьюнити проверяет, иначе — возврат донору.",
  status: "building",
  specDoc: "docs/games/escrow-task-spec.md",
};
