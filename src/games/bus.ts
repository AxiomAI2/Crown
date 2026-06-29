/**
 * Game-bus (ADR 0016): одна общая «труба» для ВСЕХ мини-игр, чтобы интерфейс `DataProvider` не рос на
 * каждую игру. Провайдер зовёт `dispatchGame`; конкретная игра кладёт свои обработчики в `GAME_HANDLERS`.
 *
 * Связи однонаправленны: шина НЕ импортирует ядро (`lib/`) — только примитивы — и НЕ знает про конкретные
 * игры (только id-строки). Значит ни циклов, ни «ядро знает про игру». Обработчики живут в `src/games/<id>/`
 * и обрабатывают свои операции сами; типобезопасность восстанавливается типизированными хуками в модуле.
 */

/** Доступ к слайсу состояния ИМЕННО этой игры. Форму состояния владеет сама игра; ядро хранит непрозрачно. */
export interface GameStateSlice {
  get<T = unknown>(): T | undefined;
  set(value: unknown): void;
}

/**
 * Контекст, который шина даёт обработчику. Намеренно узкий; расширяется по мере нужд игр (ядровые чтения и
 * запись в журнал репутации — на G1.3, когда у escrow-task появятся реальные операции; ADR 0015).
 */
export interface GameContext {
  /** Проверенный адрес вызывающего (или null, если не вошёл). */
  identity: string | null;
  channelId: string;
  /** ISO-таймстамп «сейчас» от стора (детерминируемо в тестах через подмену). */
  now: () => string;
  /** Состояние этой игры (непрозрачный для ядра слайс). */
  state: GameStateSlice;
}

export type GameHandler = (ctx: GameContext, payload: unknown) => unknown | Promise<unknown>;

export interface GameHandlers {
  /** Мутации — через `gameAction`. */
  actions?: Record<string, GameHandler>;
  /** Чтения — через `gameQuery`. */
  queries?: Record<string, GameHandler>;
}

export type GameHandlerRegistry = Record<string, GameHandlers>;

/**
 * Реестр обработчиков по id игры. Заполняется по мере готовности игр (escrow-task — G1.3). Пока пусто:
 * труба есть, операций ещё нет. Добавить игру = добавить её обработчики сюда (как манифест в `registry.ts`).
 */
export const GAME_HANDLERS: GameHandlerRegistry = {};

/** Доменная ошибка шины (мапится провайдером в DataError → доходит до клиента понятным кодом). */
export class GameBusError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GameBusError";
  }
}

/**
 * Маршрутизация операции игры к её обработчику. Бросает `GameBusError` при неизвестной игре или операции —
 * провайдер ловит и превращает в DataError. `registry` передаётся параметром (а не берётся из модуля) —
 * это и даёт тестируемость (можно подсунуть фейковую игру) без сайд-эффектов регистрации.
 */
export async function dispatchGame(
  registry: GameHandlerRegistry,
  gameId: string,
  kind: "action" | "query",
  op: string,
  ctx: GameContext,
  payload: unknown,
): Promise<unknown> {
  const handlers = registry[gameId];
  if (!handlers) throw new GameBusError("UNKNOWN_GAME", `Мини-игра не найдена: ${gameId}`);
  const table = kind === "action" ? handlers.actions : handlers.queries;
  const fn = table?.[op];
  if (!fn)
    throw new GameBusError("UNKNOWN_OP", `Операция «${op}» не поддерживается игрой ${gameId}.`);
  return fn(ctx, payload);
}
