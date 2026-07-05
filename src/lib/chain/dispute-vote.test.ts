import { describe, expect, it } from "vitest";
import { buildOpenDisputeMessage, buildVoteMessage } from "./dispute-vote";

describe("dispute-vote (кросс-языковой пин с канистрой)", () => {
  /** ТЕ ЖЕ строки, что в Rust-тесте `arbiter.rs::canonical_messages_pinned`. Менять только парой. */
  it("сообщение открытия спора байт-в-байт совпадает с Rust", () => {
    expect(buildOpenDisputeMessage("ESCROW", "chan-1", "BY")).toBe(
      "Standing: открытие спора по заданию-донату.\n\nПодписывая, вы оспариваете выполнение задания. Денег это не стоит,\nно проигранный ложный спор снимет 50 очков вашей репутации.\n\nescrow: ESCROW\nchannel: chan-1\nby: BY\nv: 2",
    );
  });

  it("сообщение голоса байт-в-байт совпадает с Rust", () => {
    expect(buildVoteMessage("ESCROW", "chan-1", "VOTER", "not_completed")).toBe(
      "Standing: голос в споре по заданию-донату.\n\nПодписывая, вы голосуете весом своей репутации на этом канале.\n\nescrow: ESCROW\nchannel: chan-1\nvoter: VOTER\nchoice: not_completed\nv: 1",
    );
  });
});
