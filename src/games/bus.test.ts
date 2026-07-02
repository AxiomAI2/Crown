import { describe, expect, it } from "vitest";
import { dispatchGame, GameBusError, type GameContext, type GameHandlerRegistry } from "./bus";

/**
 * Тесты game-bus (ADR 0016): маршрутизация операций в обработчик нужной игры, понятные ошибки на неизвестную
 * игру/операцию, и что обработчик получает контекст (личность/канал/payload) и читает-пишет свой слайс
 * состояния. Реестр передаётся параметром → подсовываем фейковую игру, без сайд-эффектов регистрации.
 */

// — простой in-memory слайс состояния для контекста —
function makeCtx(overrides: Partial<GameContext> = {}): GameContext {
  let slice: unknown;
  return {
    identity: "Donor111",
    channelId: "chan-1",
    channelOwner: "Streamer1",
    channelPayout: null,
    isChannelManager: false,
    minTaskAmountMicro: "0",
    textMaxLen: 500,
    now: () => "2026-01-01T00:00:00.000Z",
    newId: () => "id-1",
    state: {
      get: <T = unknown>() => slice as T | undefined,
      set: (v: unknown) => {
        slice = v;
      },
    },
    reputationAsOf: () => 0,
    bankLedger: () => {},
    moderate: async () => "CLEAR",
    verifyEscrow: async () => true,
    verifyTextCommitment: async () => true,
    ...overrides,
  };
}

const registry: GameHandlerRegistry = {
  "test-game": {
    actions: {
      // кладёт payload в состояние, возвращает кто и когда
      save: (ctx, payload) => {
        const prev = ctx.state.get<number>() ?? 0;
        ctx.state.set(prev + (payload as { add: number }).add);
        return { by: ctx.identity, at: ctx.now(), total: ctx.state.get<number>() };
      },
    },
    queries: {
      read: (ctx) => ({ total: ctx.state.get<number>() ?? 0, channelId: ctx.channelId }),
    },
  },
};

describe("dispatchGame — маршрутизация game-bus", () => {
  it("action идёт в нужный обработчик, видит payload/личность и пишет состояние", async () => {
    const ctx = makeCtx();
    const r = (await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 5 })) as {
      by: string;
      at: string;
      total: number;
    };
    expect(r.by).toBe("Donor111");
    expect(r.at).toBe("2026-01-01T00:00:00.000Z");
    expect(r.total).toBe(5);
  });

  it("query читает состояние, записанное action (один слайс на игру)", async () => {
    const ctx = makeCtx();
    await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 3 });
    await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 4 });
    const r = (await dispatchGame(registry, "test-game", "query", "read", ctx, undefined)) as {
      total: number;
      channelId: string;
    };
    expect(r.total).toBe(7);
    expect(r.channelId).toBe("chan-1");
  });

  it("неизвестная игра → GameBusError(UNKNOWN_GAME)", async () => {
    await expect(
      dispatchGame(registry, "no-such-game", "action", "save", makeCtx(), {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_GAME" });
  });

  it("неизвестная операция → GameBusError(UNKNOWN_OP)", async () => {
    await expect(
      dispatchGame(registry, "test-game", "action", "nope", makeCtx(), {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_OP" });
  });

  it("action и query — разные таблицы: op из action не виден как query", async () => {
    const err = await dispatchGame(registry, "test-game", "query", "save", makeCtx(), {}).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GameBusError);
    expect((err as GameBusError).code).toBe("UNKNOWN_OP");
  });
});
