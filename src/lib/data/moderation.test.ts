import { describe, expect, it } from "vitest";
import { classifyTaskText } from "./moderation";

/**
 * Тест строгой модерации ТЕКСТА ЗАДАНИЯ (escrow-task). В тест-окружении OPENAI_API_KEY нет → проверяется
 * детерминированный бэкстоп-словарь явной нелегальщины (без сети). Семантику (OpenAI) тут не гоняем.
 */
describe("classifyTaskText — бэкстоп нелегальных заданий (без OpenAI)", () => {
  it("явные преступления → HARD_BLOCK", async () => {
    for (const t of [
      "убей того парня",
      "укради телефон у соседа",
      "ограбь магазин",
      "kill him",
      "steal a car",
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
