/**
 * Модерационный конвейер (core-spec.md §8). Структура:
 *   [ВВОД] локальный wordlist → [ЯЗЫК] детект → [АВТО] классификатор → вердикт (+ дедуп по хэшу).
 *
 * Авто-слой подключаемый (AutoModerator). Сейчас — локальный wordlist. Внешний слой (OpenAI
 * omni-moderation, мультиязычный, бесплатный) — drop-in: реализовать AutoModerator с вызовом API и
 * передать в runPipeline. Здесь не подключён (нет ключей в окружении).
 */
import type { ModerationVerdict } from "./types";

export interface AutoModerator {
  classify(text: string, lang: string): ModerationVerdict;
}

const DEFAULT_HARD_LIST = ["csam", "hardblock", "убейс"];
const DEFAULT_FLAG_LIST = ["худший", "лох", "idiot", "scam"];

/** Локальный авто-модератор по словарю (дефолт). Дёшево закрывает базу; обходится мисспеллингом. */
export const localAutoModerator: AutoModerator = {
  classify(text) {
    const lower = text.toLowerCase();
    if (DEFAULT_HARD_LIST.some((w) => lower.includes(w))) return "HARD_BLOCK";
    if (DEFAULT_FLAG_LIST.some((w) => lower.includes(w))) return "FLAG";
    return "CLEAR";
  },
};

/**
 * Заглушка внешнего слоя (OpenAI omni-moderation). НЕ подключена (нет ключей). Оставлена как точка
 * расширения: реальная реализация делает запрос к API и маппит категории в вердикт.
 */
export function createOpenAiModerator(_apiKey: string): AutoModerator {
  return {
    classify() {
      throw new Error("OpenAI moderation не подключён в этом окружении (нет ключа).");
    },
  };
}

export function detectLang(text: string): string {
  if (/[¡¿]|gracias|directo/i.test(text)) return "es";
  if (/[а-яё]/i.test(text)) return "ru";
  return "en";
}

/** Стабильный хэш нормализованного контента (FNV-1a) — для дедупа карантина и опц. ончейн-якоря. */
export function hashContent(text: string): string {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  lang: string;
  contentHash: string;
  deduped: boolean; // true → решение взято из кэша (повтор контента), без повторного ревью/репорта
}

/**
 * Прогон текста через конвейер с дедупом. Дедуп — В ПРЕДЕЛАХ канала (`scope`): повтор того же контента
 * на ОДНОМ канале берётся из кэша (флуд схлопывается в O(1), без повторного ревью/репорта), но первое
 * появление на каждом канале ревьюится и репортится отдельно — у каждого стримера своя очередь T&S.
 */
export function runPipeline(
  text: string,
  cache: Map<string, ModerationVerdict>,
  opts?: { scope?: string; auto?: AutoModerator },
): ModerationOutcome {
  const contentHash = hashContent(text);
  const lang = detectLang(text);
  const key = opts?.scope ? `${opts.scope}:${contentHash}` : contentHash;
  const cached = cache.get(key);
  if (cached) return { verdict: cached, lang, contentHash, deduped: true };
  const verdict = (opts?.auto ?? localAutoModerator).classify(text, lang);
  cache.set(key, verdict);
  return { verdict, lang, contentHash, deduped: false };
}
