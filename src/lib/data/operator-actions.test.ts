import { describe, expect, it } from "vitest";
import { OPERATOR_ADDRESS } from "../chain/addresses";
import { MockDataProvider } from "./mock-provider";

/**
 * Операторские санкции (модерация платформы): полный бан кошелька и валидация целей. Тейкдаун контента
 * (снятие задания/сообщения) проверяется на уровне игры в handlers.test.ts (isContentBlocked); тут — что
 * провайдер реально ГЕЙТИТ забаненный кошелёк, требует цель у санкции и что бан переживает snapshot/restore
 * (пересборка override-наборов из журнала). Деньги ончейн санкции не трогают (§4.1/§4.2) — только офчейн.
 */

const OP = OPERATOR_ADDRESS as string; // в тестах = TREASURY_OWNER (devnet-дефолт)
const W = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // произвольный base58 «кошелёк»
const PAYOUT = "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";

function provider() {
  const p = new MockDataProvider();
  p.__setLatencyScale(0); // без искусственной задержки gate()
  return p;
}

describe("операторские санкции (applyOperatorAction)", () => {
  it("BAN_WALLET_FULL гейтит createChannel; REINSTATE по адресу снимает бан", async () => {
    const p = provider();
    p.__setAddress(OP);
    await p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "sanctions" });

    p.__setAddress(W);
    await expect(
      p.createChannel({ handle: "victim1", payoutAddress: PAYOUT }),
    ).rejects.toMatchObject({ code: "WALLET_BANNED" });

    p.__setAddress(OP);
    await p.applyOperatorAction({
      action: "REINSTATE_CHANNEL",
      targetAddress: W,
      reason: "false positive",
    });
    p.__setAddress(W);
    const ch = await p.createChannel({ handle: "victim1", payoutAddress: PAYOUT });
    expect(ch.handle).toBe("victim1"); // бан снят — кошелёк снова заводит канал
  });

  it("санкция без нужной цели → BAD_TARGET (не тихий no-op)", async () => {
    const p = provider();
    p.__setAddress(OP);
    await expect(
      p.applyOperatorAction({ action: "HIDE_MESSAGE", reason: "csam" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
    await expect(
      p.applyOperatorAction({ action: "BAN_WALLET_FULL", reason: "x" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
    await expect(
      p.applyOperatorAction({ action: "CHANNEL_BLOCK", targetChannelId: "ch-x", reason: "x" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
  });

  it("бан кошелька переживает snapshot/restore (override-набор пересобирается из журнала)", async () => {
    const p = provider();
    p.__setAddress(OP);
    await p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "sanctions" });
    const snap = p.__snapshot();

    const p2 = provider();
    p2.__restore(snap); // рестор пересобирает bannedWallets из operatorActions
    p2.__setAddress(W);
    await expect(
      p2.createChannel({ handle: "victim2", payoutAddress: PAYOUT }),
    ).rejects.toMatchObject({ code: "WALLET_BANNED" });
  });

  it("только оператор может применять санкции (чужой → FORBIDDEN)", async () => {
    const p = provider();
    p.__setAddress(W); // не оператор
    await expect(
      p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
