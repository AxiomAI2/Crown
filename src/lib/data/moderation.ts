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
    if (isExplicitCsam(text) || DEFAULT_HARD_LIST.some((w) => lower.includes(w)))
      return "HARD_BLOCK";
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

// — Политика для ТЕКСТА ЗАДАНИЯ (строже, чем донат-сообщение): задание — это инструкция ДЕЙСТВОВАТЬ, и
//   платформа фасилитировала бы преступление. Поэтому насилие/нелегальщину/угрозы блокируем по ФЛАГУ
//   категории OpenAI (а не только при высоком скоре). «Сделай 50 отжиманий» — clear; «убей того» — block. —
const TASK_HARD_CATEGORIES = [
  "sexual/minors",
  "illicit",
  "illicit/violent",
  "violence",
  "violence/graphic",
  "harassment/threatening",
  "hate/threatening",
  "self-harm/instructions",
] as const;

// Бэкстоп-словарь явно нелегальных заданий (RU/EN) — гарантирует блок даже без OpenAI (offline/прод без
// ключа). Не исчерпывающий (сленг бесконечен) — семантику добирает LLM-проверка легальности ниже.
const ILLEGAL_TASK_RE =
  /(убей|убить|убил|убива|убийств|замочи|прикончи|зарежь|застрел|избей|избить|изнасил|укради|украсть|украл|сопри|спёр|сперт|стащ|стыр|шоплифт|ворова|своров|ограбь|ограбить|похить|похити|похищ|подожги|поджечь|взорви|взорвать|теракт|\bkill\b|\bmurder\b|\bsteal\b|shoplift|\brob(?:bery)?\b|\brape\b|\bkidnap\b|\bbomb\b|terror)/i;

// Запрос к LLM: «требует ли задание совершить НЕЗАКОННОЕ действие?». Ловит сленг/эвфемизмы, которые
// moderation-эндпоинт (заточен на «вредный контент», а не на «это преступление») и словарь пропускают.
const TASK_LEGALITY_PROMPT =
  "Ты модератор заданий для стримеров; задание оплачивается донатом. Запрещены задания, требующие " +
  "совершить НЕЗАКОННОЕ или опасное действие в реальном мире: кража/шоплифтинг, насилие, угрозы, " +
  "мошенничество, вандализм, наркотики, незаконное проникновение, вред людям или животным. Разрешены " +
  "безобидные: спеть, станцевать, сыграть, отжаться, реакция, челлендж. Ответь ОДНИМ словом: ILLEGAL или OK.";

/**
 * Внешний авто-модератор поверх OpenAI omni-moderation (бесплатный endpoint /v1/moderations). Мультиязычный.
 * Нелегальщина (HARD_ALWAYS) → карантин по флагу; жёсткие угрозы/насилие (HARD_IF_SEVERE) → карантин лишь
 * при score ≥ SEVERE_THRESHOLD (шутки не режем). На сбое/таймауте — FLAG (не блокируем деньги, не авто-
 * публикуем — текст в HELD на ручное решение). Только сервер (ключ серверный).
 */
interface OpenAiModeration {
  cats: Record<string, boolean>;
  scores: Record<string, number>;
}

/** Один запрос к OpenAI omni-moderation. null — не смогли проверить (сбой/таймаут/не-OK). Только сервер. */
async function fetchOpenAiModeration(
  apiKey: string,
  text: string,
): Promise<OpenAiModeration | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    });
    if (!res.ok) {
      console.error("[moderation] OpenAI вернул", res.status);
      return null;
    }
    const r = (
      (await res.json()) as {
        results?: {
          categories?: Record<string, boolean>;
          category_scores?: Record<string, number>;
        }[];
      }
    ).results?.[0];
    return { cats: r?.categories ?? {}, scores: r?.category_scores ?? {} };
  } catch (e) {
    console.error("[moderation] OpenAI ошибка:", e);
    return null;
  }
}

/**
 * Внешний авто-модератор поверх OpenAI omni-moderation. Политика ДОНАТ-СООБЩЕНИЯ: нелегальщина
 * (HARD_ALWAYS) → карантин по флагу; жёсткие угрозы/насилие — лишь при score ≥ SEVERE_THRESHOLD (шутки
 * проходят). На сбое — FLAG (текст в HELD на ручное решение, деньги не трогаем).
 */
export function createOpenAiModerator(apiKey: string): AutoModerator {
  return {
    async classify(text) {
      if (isExplicitCsam(text)) return "HARD_BLOCK"; // явный CSAM — до запроса
      const r = await fetchOpenAiModeration(apiKey, text);
      if (!r) return "FLAG";
      if (HARD_ALWAYS.some((c) => r.cats[c])) return "HARD_BLOCK"; // нелегальщина — при любой уверенности
      // Комбо CSAM: OpenAI недооценивает sexual/minors на обходных формулировках, но даёт высокий sexual.
      if ((r.scores["sexual"] ?? 0) >= SEXUAL_COMBO_THRESHOLD && MINOR_HINT.test(text)) {
        return "HARD_BLOCK";
      }
      if (Object.entries(SEVERE_THRESHOLDS).some(([c, t]) => (r.scores[c] ?? 0) >= t)) {
        return "HARD_BLOCK"; // жёсткая угроза/насилие при высоком скоре
      }
      return "CLEAR"; // мат/шутки/обычный негатив — пропускаем, стример скрывает вручную
    },
  };
}

// Доступ к моделям может быть закрыт (ограниченный ключ без scope model.request → 401, или нет биллинга).
// Тогда отключаем LLM-проверку до перезапуска: не долбим эндпоинт и не тормозим создание каждого задания.
let llmLegalityDisabled = false;

/** LLM-классификатор легальности задания (gpt-4o-mini, дёшево). null — не смогли проверить. Только сервер. */
async function llmTaskLegality(apiKey: string, text: string): Promise<"illegal" | "ok" | null> {
  if (llmLegalityDisabled) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 4,
        messages: [
          { role: "system", content: TASK_LEGALITY_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      llmLegalityDisabled = true;
      console.error(
        "[moderation] LLM-проверка легальности недоступна (ключ без доступа к моделям) — отключаю до перезапуска",
      );
      return null;
    }
    if (!res.ok) {
      console.error("[moderation] legality LLM вернул", res.status);
      return null;
    }
    const out =
      ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]
        ?.message?.content ?? "";
    return /illegal/i.test(out) ? "illegal" : "ok";
  } catch (e) {
    console.error("[moderation] legality LLM ошибка:", e);
    return null;
  }
}

/**
 * Модерация ТЕКСТА ЗАДАНИЯ (escrow-task): строже донат-сообщения, т.к. задание ОПЛАЧИВАЕТСЯ и платформа
 * фасилитировала бы действие. Слои: (1) бэкстоп-словарь явной нелегальщины (offline); (2) OpenAI
 * omni-moderation — блок по флагу опасной категории; (3) LLM-проверка «это призыв к незаконному действию?»
 * — ловит сленг/эвфемизмы вроде «сопри молоко в магазе», которые первые два слоя пропускают. Любой слой
 * сказал «нельзя» → HARD_BLOCK (задание не создаётся). Оба внешних слоя не смогли проверить → FLAG (создание
 * не рубим жёстко: финальный фильтр — гейт стримера «Принять/Отклонить»). Только сервер (ключ серверный).
 */
export async function classifyTaskText(text: string): Promise<ModerationVerdict> {
  if (isExplicitCsam(text) || ILLEGAL_TASK_RE.test(text)) return "HARD_BLOCK";
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  if (!key) return "CLEAR"; // без ключа — только бэкстоп-словарь (mock-клиент/прод без ключа)

  const mod = await fetchOpenAiModeration(key, text);
  if (mod && TASK_HARD_CATEGORIES.some((c) => mod.cats[c])) return "HARD_BLOCK";

  const legality = await llmTaskLegality(key, text);
  if (legality === "illegal") return "HARD_BLOCK";

  if (mod === null && legality === null) return "FLAG"; // оба внешних слоя недоступны
  return "CLEAR";
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
