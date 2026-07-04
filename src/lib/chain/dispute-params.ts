/**
 * Governance-параметры споров канала (M1, ADR 0021) — изоморфный модуль без web3.js.
 *
 * Канон хранения — core-канистра ICP (`canister/core/src/governance.rs`): запись только
 * ed25519-подписью владельца канала над каноническим сообщением отсюда, вступление с таймлоком.
 * ВАЖНО: `buildDisputeParamsMessage` обязан порождать БАЙТ-В-БАЙТ ту же строку, что Rust
 * (`governance.rs::build_params_message`) — общий пин в тестах обеих сторон
 * (dispute-params.test.ts ↔ governance.rs::canonical_message_pinned). Меняется только через `v:`.
 */

/** Значения параметров: деньги/очки — целые micro (bigint), K — милли, окна — секунды. */
export interface DisputeParamsValues {
  /** Порог репутации для права ОТКРЫТЬ спор (micro-очки). */
  minReputationToDisputeMicro: bigint;
  /** Порог веса присяжного (micro-очки). */
  minWeightToVoteMicro: bigint;
  /** K в кворуме `max(1, ceil(K·√(сумма в USDC)))`, в тысячных (2000 = 2.0). */
  quorumCoefficientMilli: number;
  /** Окно «поднять спор» от «Готово», сек. */
  disputeWindowSecs: number;
  /** Окно голосования, сек. */
  votingWindowSecs: number;
  /** Потолок суммы задания (micro-USDC); 0n = не ограничен. */
  dMaxMicro: bigint;
}

/** Состояние параметров канала в канистре (ответ /dispute-params). */
export interface DisputeParamsInfo {
  channelId: string;
  /** Владелец ИЗ ЦЕПОЧКИ (плательщик активации в журнале канистры); null = канал не активирован. */
  owner: string | null;
  /** Последняя принятая версия (0 = записей не было). */
  version: number;
  /** true = канал ничего не менял, действуют дефолты. */
  isDefault: boolean;
  effective: DisputeParamsValues;
  pending: { params: DisputeParamsValues; effectiveAtMs: number; version: number } | null;
}

/** Каноническое сообщение под подпись кошелька. НЕ МЕНЯТЬ без синхронной правки Rust и `v:`. */
export function buildDisputeParamsMessage(
  channelId: string,
  owner: string,
  version: number,
  p: DisputeParamsValues,
): string {
  return [
    "Standing: параметры споров канала.",
    "",
    "Подписывая, вы устанавливаете правила споров для своего канала.",
    "Изменения вступят после таймлока — идущие споры играются по прежним правилам.",
    "",
    `channel: ${channelId}`,
    `owner: ${owner}`,
    `version: ${version}`,
    `minReputationToDisputeMicro: ${p.minReputationToDisputeMicro}`,
    `minWeightToVoteMicro: ${p.minWeightToVoteMicro}`,
    `quorumCoefficientMilli: ${p.quorumCoefficientMilli}`,
    `disputeWindowSecs: ${p.disputeWindowSecs}`,
    `votingWindowSecs: ${p.votingWindowSecs}`,
    `dMaxMicro: ${p.dMaxMicro}`,
    "v: 1",
  ].join("\n");
}

/** JSON-поля параметров из канистры (числа или десятичные строки — деньги строками). */
interface RawParams {
  minReputationToDisputeMicro: number | string;
  minWeightToVoteMicro: number | string;
  quorumCoefficientMilli: number | string;
  disputeWindowSecs: number | string;
  votingWindowSecs: number | string;
  dMaxMicro: number | string;
}

export interface RawDisputeParamsResponse {
  channelId: string;
  owner: string | null;
  version: number;
  isDefault: boolean;
  effective: RawParams;
  pending: { params: RawParams; effectiveAtNs: string; version: number } | null;
}

function normalizeValues(raw: RawParams): DisputeParamsValues {
  return {
    minReputationToDisputeMicro: BigInt(raw.minReputationToDisputeMicro),
    minWeightToVoteMicro: BigInt(raw.minWeightToVoteMicro),
    quorumCoefficientMilli: Number(raw.quorumCoefficientMilli),
    disputeWindowSecs: Number(raw.disputeWindowSecs),
    votingWindowSecs: Number(raw.votingWindowSecs),
    dMaxMicro: BigInt(raw.dMaxMicro),
  };
}

/** Ответ канистры → типизированное состояние (ns → ms на границе). */
export function normalizeDisputeParams(raw: RawDisputeParamsResponse): DisputeParamsInfo {
  return {
    channelId: raw.channelId,
    owner: raw.owner,
    version: raw.version,
    isDefault: raw.isDefault,
    effective: normalizeValues(raw.effective),
    pending: raw.pending
      ? {
          params: normalizeValues(raw.pending.params),
          effectiveAtMs: Number(BigInt(raw.pending.effectiveAtNs) / 1_000_000n),
          version: raw.pending.version,
        }
      : null,
  };
}
