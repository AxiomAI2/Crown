/**
 * Споры в канистре (M2, ADR 0021) — канонические сообщения подписи кошелька: открытие спора
 * и голос. Изоморфный модуль без web3.js.
 *
 * ВАЖНО: строки обязаны байт-в-байт совпадать с Rust (`canister/core/src/arbiter.rs`) —
 * парные пин-тесты: dispute-vote.test.ts ↔ arbiter.rs::canonical_messages_pinned.
 * Анти-replay: адрес эскроу-аккаунта + канал + (для голоса) выбор — внутри подписанного текста.
 */

export type DisputeVoteChoice = "completed" | "not_completed";

/** Открытие спора: подписывает инициатор (вес ≥ порога канала проверяет канистра). */
export function buildOpenDisputeMessage(
  escrowAccount: string,
  channelId: string,
  by: string,
): string {
  return [
    "Standing: открытие спора по заданию-донату.",
    "",
    "Подписывая, вы оспариваете выполнение задания. Денег это не стоит,",
    "но проигранный ложный спор снимет 50 очков вашей репутации.",
    "",
    `escrow: ${escrowAccount}`,
    `channel: ${channelId}`,
    `by: ${by}`,
    "v: 2",
  ].join("\n");
}

/** Голос: вес = снимок репутации голосующего на канале в момент открытия спора (канистра). */
export function buildVoteMessage(
  escrowAccount: string,
  channelId: string,
  voter: string,
  choice: DisputeVoteChoice,
): string {
  return [
    "Standing: голос в споре по заданию-донату.",
    "",
    "Подписывая, вы голосуете весом своей репутации на этом канале.",
    "",
    `escrow: ${escrowAccount}`,
    `channel: ${channelId}`,
    `voter: ${voter}`,
    `choice: ${choice}`,
    "v: 1",
  ].join("\n");
}
