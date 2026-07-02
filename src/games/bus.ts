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
 * Запись в журнал репутации от игры (ADR 0015). Провайдер банкует её как `LedgerEvent` на канале `channelId`
 * контекста. `address` — чьей репутации касается (донор/инициатор спора). Деньги-провенанс — строкой micro.
 */
export interface GameLedgerEntry {
  address: string;
  type: "DONATION" | "GAME" | "DISPUTE_WON" | "DISPUTE_LOST" | "REFUND";
  pointsDelta: number;
  amount?: string;
}

/**
 * Контекст, который шина даёт обработчику: личность, канал, время, генератор id, свой слайс состояния и
 * УЗКИЕ мостики в ядро (репутация на момент + запись в журнал; ADR 0015). Провайдер реализует мостики —
 * обработчик игры остаётся над ядром и не лезет в стор напрямую.
 */
export interface GameContext {
  /** Проверенный адрес вызывающего (или null, если не вошёл). */
  identity: string | null;
  channelId: string;
  /** Владелец канала (стример) — для авторизации действий вроде «Принять»/«Готово». */
  channelOwner: string | null;
  /** Payout-адрес канала (получатель денег на цепочке). Нужен, чтобы привязать эскроу к каналу (ESC-6). */
  channelPayout: string | null;
  /** Вызывающий — менеджер канала (владелец или модератор из конфига): видит приватный текст задания (§4.6). */
  isChannelManager: boolean;
  /** Минимум суммы задания-доната, micro-USDC строкой: задание = донат с текстом, действует бóльший из
   *  minDonation/minDonationWithText канала (спека §10 — рычаг стримера). Проверяется в create (BELOW_MIN). */
  minTaskAmountMicro: string;
  /** Мин. репутация (очки), чтобы прислать задание (§10 рычаг стримера) — гейт в create (LOW_REP). 0 = без порога. */
  minReputationToTask: number;
  /** Мин. репутация (очки), чтобы поднять спор (§10 рычаг стримера) — гейт в raiseDispute (LOW_REP). Гейтит
   *  ПРАВО поднять спор, не вес голоса и не исход. 0 = без порога. */
  minReputationToDispute: number;
  /** Канальный лимит длины текста (messageMaxLen) — к тексту задания, как у донат-сообщений (TOO_LONG, B4). */
  textMaxLen: number;
  /** ISO-таймстамп «сейчас» от стора (детерминируемо в тестах через подмену). */
  now: () => string;
  /** Новый уникальный id (для создаваемых сущностей игры). */
  newId: () => string;
  /** Состояние этой игры (непрозрачный для ядра слайс). */
  state: GameStateSlice;
  /** Вес = очки адреса в этом канале на момент `asOf` (снэпшот; computePointsAsOf). Оператор репутацию не
   *  редактирует (CR-1) → вес честный; наказание нарушителя — блок кошелька/канала, не правка числа. */
  reputationAsOf: (address: string, asOf: string) => number;
  /** Забанковать эффекты на репутацию в журнал канала (ADR 0015). */
  bankLedger: (entries: GameLedgerEntry[]) => void;
  /** Модерация текста (UGC игры): вердикт. HARD_BLOCK → запрещённый/опасный контент, не пропускаем. */
  moderate: (text: string) => Promise<"CLEAR" | "FLAG" | "HARD_BLOCK">;
  /** Политика публикации текста канала (как у донат-сообщений): auto_if_clean → чистый текст сразу SHOWN. */
  textShowMode?: "manual" | "auto_if_clean";
  /**
   * Трастлесс-сверка ончейн-эскроу (chain-режим, ADR 0017): аккаунт существует, владелец = программа,
   * донор/сумма совпадают. Закрывает доверие к клиенту (нельзя записать задание без реального эскроу или с
   * чужой суммой). В mock/api денег нет → всегда true. Сервер в chain-режиме читает devnet.
   */
  verifyEscrow: (
    escrowTaskId: string,
    expect: { donor: string; amount: string; streamer?: string },
  ) => Promise<boolean>;
  /**
   * Сверка ончейн-коммитмента текста задания (CR-4): `escrowTaskId` (seed эскроу-PDA) обязан равняться
   * `SHA-256(nonce ‖ text)`. Гарантирует, что зеркало несёт РОВНО тот текст, что вшит в ончейн-адрес — клиент
   * не сможет профандить один текст и записать другой, а оператор потом не подменит текст незаметно. Чистая
   * крипта (браузер+сервер), не читает цепочку. Зовётся только для chain-задания (есть `escrowTaskId`); без
   * `nonce` → false (fail-closed).
   */
  verifyTextCommitment: (escrowTaskId: string, text: string, nonce?: string) => Promise<boolean>;
  /**
   * Реконсайл репутации против ЦЕПОЧКИ (ESC-12/M3, chain-режим): ончейн-исход эскроу (деньги = истина).
   * `"to_streamer"|"to_donor"` — исход подтверждён (живая `resolution` или индексированный claim);
   * `null` — исход неизвестен (Unresolved / не проиндексирован / сбой RPC / вне chain-режима) → банковку
   * откладываем. Отсутствует (mock/api) → задание без `escrowTaskId`, сверка с цепочкой не нужна.
   */
  escrowOutcome?: (escrowTaskId: string) => Promise<"to_streamer" | "to_donor" | null>;
  /**
   * Сырое ончейн-состояние эскроу (ESC-19): 0 Pending, 1 Accepted, 2 Done, 3 Resolved, 4 Disputed; `null` —
   * не настроено / аккаунт закрыт / сбой RPC. Нужно, чтобы офчейн раскрыть текст задания по ончейн-`accept`
   * (state≥Accepted) НЕЗАВИСИМО от UI — стример не может забрать деньги, не приняв, а accept обнажает текст.
   */
  escrowState?: (escrowTaskId: string) => Promise<number | null>;
  /**
   * Операторский тейкдаун контента (модерация платформы): снят ли этот id (задания/сообщения) с публикации.
   * Источник истины — override-набор провайдера (журнал операторских действий), НЕ игровой слайс. Перебивает
   * всё: стример не покажет, авто-раскрытие по цепочке (ESC-19) не вернёт. Отсутствует (нет операторских
   * действий) → ничего не снято. Деньги ончейн это не трогает — только видимость (§4.1/§4.2).
   */
  isContentBlocked?: (contentId: string) => boolean;
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
 * Реестр обработчиков по id игры. Заполняется при импорте из `games/index.ts` (сейчас — `escrow-task`).
 * Добавить игру = зарегистрировать её обработчики там (как манифест в `registry.ts`).
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
