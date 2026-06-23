/**
 * Модерационный конвейер (core-spec.md §8). Структура:
 *   [ВВОД] → [ЯЗЫК] детект → [АВТО] классификатор → вердикт (+ дедуп по хэшу).
 *
 * Авто-слой подключаемый и АСИНХРОННЫЙ (AutoModerator). По умолчанию — локальный wordlist (только явные
 * хард-маркеры). Если задан серверный OPENAI_API_KEY — используется OpenAI omni-moderation (бесплатный,
 * мультиязычный, текст+картинки). Выбор делает resolveAutoModerator() по env (ключ серверный, в браузер не
 * попадает → клиент всегда на словаре).
 */
import type { ModerationVerdict } from "./types";

export interface AutoModerator {
  classify(text: string, lang: string): Promise<ModerationVerdict>;
}

// ПОЛИТИКА (решение продукта): отдельные слова и мат НЕ цензурим и НЕ флагаем — это вкус стримера, он
// скрывает вручную. Авто-слой ловит только запрещёнку → HARD_BLOCK (карантин + эскалация в T&S). FLAG-
// словаря по умолчанию НЕТ. Семантический детект — OpenAI (ниже); локальный список — заглушка под явные маркеры.
const DEFAULT_HARD_LIST = ["csam", "childporn", "child porn", "zoophilia", "hardblock"];
const DEFAULT_FLAG_LIST: string[] = [];

// Явные маркеры CSAM (RU/EN) — backstop НЕЗАВИСИМО от OpenAI: он недооценивает обходные формулировки
// (напр. «порнография младше 18» даёт sexual/minors≈0.02, хотя «детское порно» ловит на 0.9).
const CSAM_EXPLICIT =
  /детск\S*\s*порн|порн\S*\s*детск|малолет\S*\s*порн|порн\S*\s*малолет|child\s*-?\s*porn|childporn|\bcsam\b|pedophil|педофил/i;
// Признак несовершеннолетия — НЕ сам по себе, а в КОМБО с сексуальным контентом (sexual ≥ порога) → CSAM.
// Не ловит 18+/«25 лет»/«18 лет»: «18 лет» — взрослый, «младше 18» — несовершеннолетний.
const MINOR_HINT =
  /младше\s*1[0-8]|меньше\s*1[0-8]|до\s*1[0-7]\b|\b1[0-7]\s*(лет|год|года)|несовершеннолет|малолет|школьниц|\b(child|minor|underage|preteen|teen)\b/i;
const SEXUAL_COMBO_THRESHOLD = 0.3; // выше этого «секса» + признак несовершеннолетия = карантин

/** Прямой явный CSAM-маркер (RU/EN) — общий для локального и OpenAI-модератора. */
function isExplicitCsam(text: string): boolean {
  return CSAM_EXPLICIT.test(text);
}

/** Локальный авто-модератор: ловит хард-маркеры запрещёнки/CSAM; мат/любые слова пропускает (CLEAR). */
export const localAutoModerator: AutoModerator = {
  async classify(text) {
    const lower = text.toLowerCase();
    if (isExplicitCsam(text) || DEFAULT_HARD_LIST.some((w) => lower.includes(w))) return "HARD_BLOCK";
    if (DEFAULT_FLAG_LIST.some((w) => lower.includes(w))) return "FLAG";
    return "CLEAR";
  },
};

// Маппинг категорий OpenAI omni-moderation → авто-карантин (HARD_BLOCK).
//  • HARD_ALWAYS — нулевая толерантность: карантин при ЛЮБОЙ уверенности (нелегальщина, юридический must).
//  • HARD_IF_SEVERE — жёсткие угрозы/насилие: карантин ТОЛЬКО при ВЫСОКОЙ уверенности (по category_scores),
//    чтобы шутки/банты/«я тебя урою в катке» с низким скором проходили. Порог поднимай/опускай SEVERE_THRESHOLD.
//  Всё прочее (мат, оскорбления, обычный hate/sexual) НЕ баним — стример скрывает сам.
const HARD_ALWAYS = ["sexual/minors"] as const;
// Жёсткие угрозы/насилие — карантин при ВЫСОКОМ скоре, порог СВОЙ на категорию (шутки/гейминг-банты дают
// низкий скор и проходят). Калибровано на примерах: реальная угроза violence≈0.95, harassment/threatening
// ≈0.55-0.74; шуточное «урою в катке лол» violence≈0.42, h/threatening≈0.26. Поднимай пороги — мягче.
const SEVERE_THRESHOLDS: Record<string, number> = {
  violence: 0.8, // «прям жёсткое насилие»; гейминг-банты (~0.4) проходят
  "violence/graphic": 0.6, // гор/расчленёнка
  "harassment/threatening": 0.5, // адресная угроза человеку
  "hate/threatening": 0.5, // угроза на почве ненависти
};

/**
 * Внешний авто-модератор поверх OpenAI omni-moderation (бесплатный endpoint /v1/moderations). Мультиязычный.
 * Нелегальщина (HARD_ALWAYS) → карантин по флагу; жёсткие угрозы/насилие (HARD_IF_SEVERE) → карантин лишь
 * при score ≥ SEVERE_THRESHOLD (шутки не режем). На сбое/таймауте — FLAG (не блокируем деньги, не авто-
 * публикуем — текст в HELD на ручное решение). Только сервер (ключ серверный).
 */
export function createOpenAiModerator(apiKey: string): AutoModerator {
  return {
    async classify(text) {
      // Явный CSAM-маркер ловим ДО запроса (работает даже если OpenAI недоступен и недооценивает формулировку).
      if (isExplicitCsam(text)) return "HARD_BLOCK";
      try {
        const res = await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
        });
        if (!res.ok) {
          console.error("[moderation] OpenAI вернул", res.status);
          return "FLAG"; // не смогли проверить → на ручное решение (не показываем авто), деньги не трогаем
        }
        const r = (
          (await res.json()) as {
            results?: {
              categories?: Record<string, boolean>;
              category_scores?: Record<string, number>;
            }[];
          }
        ).results?.[0];
        const cats = r?.categories ?? {};
        const scores = r?.category_scores ?? {};
        if (HARD_ALWAYS.some((c) => cats[c])) return "HARD_BLOCK"; // нелегальщина — при любой уверенности
        // Комбо CSAM: OpenAI часто недооценивает sexual/minors на обходных формулировках («порнография
        // младше 18» → 0.02), но даёт высокий sexual. Секс-контент + признак несовершеннолетия = карантин.
        if ((scores["sexual"] ?? 0) >= SEXUAL_COMBO_THRESHOLD && MINOR_HINT.test(text)) {
          return "HARD_BLOCK";
        }
        if (Object.entries(SEVERE_THRESHOLDS).some(([c, t]) => (scores[c] ?? 0) >= t)) {
          return "HARD_BLOCK"; // жёсткая угроза/насилие при высоком скоре
        }
        return "CLEAR"; // мат/шутки/обычный негатив — пропускаем, стример скрывает вручную
      } catch (e) {
        console.error("[moderation] OpenAI ошибка:", e);
        return "FLAG";
      }
    },
  };
}

// Выбор авто-модератора по серверному env (мемоизируется). OPENAI_API_KEY — серверная переменная (НЕ
// NEXT_PUBLIC), в браузерный bundle не попадает → в mock/api клиенте всегда локальный словарь.
let cachedModerator: AutoModerator | null = null;
export function resolveAutoModerator(): AutoModerator {
  if (cachedModerator) return cachedModerator;
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  cachedModerator = key ? createOpenAiModerator(key) : localAutoModerator;
  return cachedModerator;
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
export async function runPipeline(
  text: string,
  cache: Map<string, ModerationVerdict>,
  opts?: { scope?: string; auto?: AutoModerator },
): Promise<ModerationOutcome> {
  const contentHash = hashContent(text);
  const lang = detectLang(text);
  const key = opts?.scope ? `${opts.scope}:${contentHash}` : contentHash;
  const cached = cache.get(key);
  if (cached) return { verdict: cached, lang, contentHash, deduped: true };
  const verdict = await (opts?.auto ?? localAutoModerator).classify(text, lang);
  cache.set(key, verdict);
  return { verdict, lang, contentHash, deduped: false };
}
