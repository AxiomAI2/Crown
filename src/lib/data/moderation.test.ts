import { describe, expect, it } from "vitest";
import { classifyTaskText } from "./moderation";

/**
 * Тест строгой модерации ТЕКСТА ЗАДАНИЯ (escrow-task). В тест-окружении OPENAI_API_KEY нет → проверяется
 * детерминированный бэкстоп-словарь явной нелегальщины (без сети). Семантику (OpenAI) тут не гоняем.
 */
describe("classifyTaskText — бэкстоп нелегальных заданий (без OpenAI)", () => {
  it("явные преступления (вкл. сленг кражи) → HARD_BLOCK", async () => {
    for (const t of [
      "убей того парня",
      "укради телефон у соседа",
      "сопри молоко в магазе",
      "стащи шоколадку",
      "ограбь магазин",
      "kill him",
      "shoplift a candy",
    ]) {
      expect(await classifyTaskText(t)).toBe("HARD_BLOCK");
    }
  });

  it("CSAM-маркер → HARD_BLOCK", async () => {
    expect(await classifyTaskText("детское порно")).toBe("HARD_BLOCK");
  });

  it("нормальные задания → CLEAR", async () => {
    for (const t of ["станцуй джигу", "сделай 50 отжиманий", "спой песню", "покажи сетап"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
  });
});
