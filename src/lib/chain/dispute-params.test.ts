import { describe, expect, it } from "vitest";
import { buildDisputeParamsMessage, normalizeDisputeParams } from "./dispute-params";

describe("dispute-params (кросс-языковой пин с канистрой)", () => {
  /**
   * ТА ЖЕ строка, что в Rust-тесте `governance.rs::canonical_message_pinned`.
   * Разошлись — подпись из студии перестанет приниматься канистрой. Менять только парой + `v:`.
   */
  it("каноническое сообщение байт-в-байт совпадает с Rust", () => {
    const msg = buildDisputeParamsMessage("chan-1", "OWNER", 1, {
      minReputationToDisputeMicro: 1_000_000n,
      minWeightToVoteMicro: 1_000_000n,
      quorumMicro: 1_000_000n,
      disputeWindowSecs: 120,
      votingWindowSecs: 120,
      dMaxMicro: 0n,
    });
    const expected =
      "Standing: параметры споров канала.\n\nПодписывая, вы устанавливаете правила споров для своего канала.\nИзменения вступят после таймлока — идущие споры играются по прежним правилам.\n\nchannel: chan-1\nowner: OWNER\nversion: 1\nminReputationToDisputeMicro: 1000000\nminWeightToVoteMicro: 1000000\nquorumMicro: 1000000\ndisputeWindowSecs: 120\nvotingWindowSecs: 120\ndMaxMicro: 0\nv: 2";
    expect(msg).toBe(expected);
  });

  it("нормализация ответа канистры: строки денег → bigint, ns → ms", () => {
    const info = normalizeDisputeParams({
      channelId: "c",
      owner: "O",
      version: 1,
      isDefault: false,
      effective: {
        minReputationToDisputeMicro: 1_000_000,
        minWeightToVoteMicro: 1_000_000,
        quorumMicro: 1_000_000,
        disputeWindowSecs: 120,
        votingWindowSecs: 120,
        dMaxMicro: "0",
      },
      pending: {
        params: {
          minReputationToDisputeMicro: 2_000_000,
          minWeightToVoteMicro: 1_000_000,
          quorumMicro: "1000000",
          disputeWindowSecs: 180,
          votingWindowSecs: 300,
          dMaxMicro: "50000000",
        },
        effectiveAtNs: "1783176899623489861",
        version: 1,
      },
    });
    expect(info.effective.dMaxMicro).toBe(0n);
    expect(info.pending?.params.dMaxMicro).toBe(50_000_000n);
    expect(info.pending?.effectiveAtMs).toBe(1783176899623);
  });
});
