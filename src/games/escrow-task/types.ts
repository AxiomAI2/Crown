/**
 * Модель данных мини-игры «задание-донат» (спека `docs/games/escrow-task-spec.md` §5/§6). Чистые данные —
 * без React и IO. Деньги храним как ДЕСЯТИЧНУЮ СТРОКУ micro-USDC (JSON-чисто; bigint только на границе при
 * банковании в журнал репутации), чтобы непрозрачный слайс состояния игры (ADR 0016) сериализовался без
 * codec-тегов.
 */

/** Стадия задания (хранимая). Терминальная — `RESOLVED` (+ `resolution`). Время «доводит» стадии — см. machine.ts. */
export type TaskStatus = "PENDING" | "ACCEPTED" | "DONE" | "DISPUTED" | "RESOLVED";

/** Куда ушли деньги по итогу. */
export type TaskOutcome = "to_streamer" | "to_donor";

/** Почему так разрешилось (для UI и журнала). */
export type ResolutionReason =
  | "rejected" // стример отклонил → донору
  | "expired" // не принят за окно → донору
  | "canceled" // отмена в грейс-окне → донору
  | "no_show" // принял, но не нажал «Готово» в срок → донору
  | "completed" // «Готово», спора не было → стримеру
  | "vote_completed" // голос «выполнил» → стримеру
  | "vote_not_completed" // голос «не выполнил» → донору (100%)
  | "no_quorum" // кворум не собран → стримеру (дефолт)
  | "tie"; // ничья по весу → стримеру (презумпция, спека §11)

export type VoteChoice = "completed" | "not_completed";

export interface TaskVote {
  voter: string; // адрес
  choice: VoteChoice;
  weight: number; // вес = репутация на снэпшоте (computePointsAsOf на момент спора)
  at: string; // ISO
}

export interface TaskDispute {
  by: string; // инициатор
  openedAt: string; // ISO — момент снэпшота веса
  votingEndsAt: string; // ISO
  quorum: number; // требуемый суммарный вес (в очках репутации)
  votes: TaskVote[];
}

export interface TaskResolution {
  outcome: TaskOutcome;
  reason: ResolutionReason;
  resolvedAt: string; // ISO
  claimed: boolean; // claim-модель (ADR 0015): получатель ещё не забрал деньги
}

export interface EscrowTask {
  id: string;
  channelId: string;
  donor: string; // адрес донора
  amount: string; // micro-USDC десятичной строкой
  text: string; // текст задания (UGC; модерация — на G2)
  createdAt: string; // ISO
  // Срок сдачи (нажать «Готово»), отсчитывается от создания (= ончейн done_deadline). После него — возврат
  // донору (no-show). Задаётся при createTask, не сбрасывается.
  executionDeadline: string; // ISO
  status: TaskStatus;

  // Ончейн-эскроу (chain-режим, G3a; ADR 0017). В mock/api пусто — деньги мок.
  escrowTaskId?: string; // hex 32-байтового seed эскроу-PDA (клиент генерит при создании)
  fundTx?: string; // подпись tx фандинга эскроу

  // ACCEPTED:
  graceUntil?: string; // ISO — окно отмены донором

  // DONE:
  disputeWindowEndsAt?: string; // ISO — до него можно поднять спор

  // DISPUTED:
  dispute?: TaskDispute;

  // RESOLVED:
  resolution?: TaskResolution;

  // Модерация текста задания. Деньги/эскроу от текста не зависят (§7 «деньги ≠ показ»). Владелец/автор видят
  // текст всегда; в ПУБЛИЧНОЙ ленте — только SHOWN. Пусто = SHOWN (совместимость со старыми заданиями).
  reports?: TaskReport[];
  textState?: "SHOWN" | "HELD" | "HIDDEN"; // HELD — в очереди модерации до «Показать»; HIDDEN — скрыт (жалобы/стример)
  // Стример «отклонил» задание: прячем из ленты/«Активных» БЕЗ ончейн-tx и без немедленного возврата. Эскроу
  // остаётся и вернётся донору сам по таймеру (no-show) — стример не платит газ/комиссию. Деньги/статус не трогаем.
  hidden?: boolean;
}

/** Жалоба зрителя на текст задания (публичный UGC). Дедуп по reporter, как у жалоб на сообщения доната. */
export interface TaskReport {
  reporter: string;
  reason?: string;
  ts: string; // ISO
}

/** Эффект на репутацию для бановки в журнал (ADR 0015). Деньги-провенанс — строкой micro. */
export interface RepEffect {
  address: string;
  type: "DONATION" | "DISPUTE_WON" | "DISPUTE_LOST";
  pointsDelta: number;
  amount?: string; // micro-USDC (для DONATION)
}
