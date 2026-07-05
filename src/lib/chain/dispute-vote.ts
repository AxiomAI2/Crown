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

// ─────────── вид спора из канистры (ответ GET /dispute, arbiter/http.rs::case_json) ───────────

export interface CanisterDisputeVote {
  voter: string;
  choice: DisputeVoteChoice;
  weightMicro: bigint;
  atMs: number;
}

export interface CanisterDisputeView {
  escrowAccount: string;
  channelId: string;
  escrowTaskId: string | null; // hex-seed эскроу-PDA — ключ соединения с задачей сервера (task.escrowTaskId)
  status: string; // DISPUTED | RESOLVED (машина канистры)
  openedBy: string | null;
  openedAtMs: number | null;
  votingEndsAtMs: number | null;
  quorumMicro: bigint;
  votes: CanisterDisputeVote[];
  tallyCompletedMicro: bigint;
  tallyNotCompletedMicro: bigint;
  markDisputedTx: string | null;
  resolveTx: string | null;
  lastSendError: string | null;
  verdict: { outcome: "to_streamer" | "to_donor"; reason: string; finalizedAtMs: number } | null;
}

/** Сырой JSON канистры → типизированный вид (деньги/веса строками → bigint). */
export function normalizeCanisterDispute(raw: {
  escrowAccount: string;
  channelId: string;
  escrowTaskId?: string | null;
  status: string;
  openedBy: string | null;
  openedAtMs: number | null;
  votingEndsAtMs: number | null;
  quorumMicro: string | null;
  votes: { voter: string; choice: string; weightMicro: string; atMs: number }[] | null;
  tally: { completedMicro: string; notCompletedMicro: string };
  markDisputedTx: string | null;
  resolveTx: string | null;
  lastSendError: string | null;
  verdict: { outcome: string; reason: string; finalizedAtMs: number } | null;
}): CanisterDisputeView {
  return {
    escrowAccount: raw.escrowAccount,
    channelId: raw.channelId,
    escrowTaskId: raw.escrowTaskId ?? null,
    status: raw.status,
    openedBy: raw.openedBy,
    openedAtMs: raw.openedAtMs,
    votingEndsAtMs: raw.votingEndsAtMs,
    quorumMicro: BigInt(raw.quorumMicro ?? 0),
    votes: (raw.votes ?? []).map((v) => ({
      voter: v.voter,
      choice: v.choice as DisputeVoteChoice,
      weightMicro: BigInt(v.weightMicro),
      atMs: v.atMs,
    })),
    tallyCompletedMicro: BigInt(raw.tally.completedMicro),
    tallyNotCompletedMicro: BigInt(raw.tally.notCompletedMicro),
    markDisputedTx: raw.markDisputedTx,
    resolveTx: raw.resolveTx,
    lastSendError: raw.lastSendError,
    verdict: raw.verdict
      ? {
          outcome: raw.verdict.outcome as "to_streamer" | "to_donor",
          reason: raw.verdict.reason,
          finalizedAtMs: raw.verdict.finalizedAtMs,
        }
      : null,
  };
}
