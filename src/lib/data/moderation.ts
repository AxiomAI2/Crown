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
const localAutoModerator: AutoModerator = {
  async classify(text) {
    const lower = text.toLowerCase();
    if (isExplicitCsam(text) || DEFAULT_HARD_LIST.some((w) => lower.includes(w)))
      return "HARD_BLOCK";
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

// НЕТ словаря-бэкстопа по ключевым словам: он даёт ложные блоки (напр. «сопри/укради флаг», «ограбь базу»
// — легальные внутриигровые задания), а сленг всё равно бесконечен. Легальность задания определяет ТОЛЬКО
// семантический ИИ ниже (понимает контекст). Единственное жёсткое исключение — CSAM-маркер (isExplicitCsam).

// Запрос к LLM: «требует ли задание совершить НЕЗАКОННОЕ действие?». Ловит сленг/эвфемизмы, которые
// moderation-эндпоинт (заточен на «вредный контент», а не на «это преступление») и словарь пропускают.
const TASK_LEGALITY_PROMPT =
  "Ты модератор заданий для стримеров; задание оплачивается донатом. Запрещены задания, требующие " +
  "совершить НЕЗАКОННОЕ или опасное действие в реальном мире: кража/шоплифтинг, насилие, угрозы, " +
  "мошенничество, вандализм, наркотики, незаконное проникновение, вред людям или животным. Разрешены " +
  "безобидные: спеть, станцевать, сыграть, отжаться, реакция, челлендж. Правило при сомнении: лучше " +
  "перестраховаться — если формулировка двусмысленная или непонятно, реальное это действие или игровое, " +
  "отвечай ILLEGAL. Ответь ОДНИМ словом: ILLEGAL или OK.";

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
function createOpenAiModerator(apiKey: string): AutoModerator {
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
// Тогда временно отключаем LLM-проверку (КУЛДАУН, не навсегда — B6): транзиентный 401/403 не должен глушить
// слой легальности до перезапуска. По истечении кулдауна сами пробуем снова → самовосстановление.
const LLM_LEGALITY_COOLDOWN_MS = 10 * 60_000; // 10 мин
let llmLegalityCooldownUntil = 0;

/** LLM-классификатор легальности задания (gpt-4o-mini, дёшево). null — не смогли проверить. Только сервер. */
async function llmTaskLegality(apiKey: string, text: string): Promise<"illegal" | "ok" | null> {
  if (Date.now() < llmLegalityCooldownUntil) return null;
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
      llmLegalityCooldownUntil = Date.now() + LLM_LEGALITY_COOLDOWN_MS;
      console.error(
        "[moderation] LLM-проверка легальности недоступна (ключ без доступа к моделям) — пауза на 10 мин",
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
 * фасилитировала бы действие. Судит семантический ИИ, без словаря ключевых слов (он ложно блочил легальные
 * внутриигровые «укради/сопри/ограбь …»). Слои: (1) жёсткий CSAM-маркер — единственный безусловный блок;
 * (2) OpenAI omni-moderation — блок по флагу опасной категории; (3) LLM-проверка «это призыв к незаконному
 * действию?» — ловит сленг/эвфемизмы вроде «сопри молоко в магазе», понимая контекст. Любой слой сказал
 * «нельзя» → HARD_BLOCK (задание не создаётся). Оба внешних слоя не смогли проверить → FLAG (создание не
 * рубим жёстко: финальный фильтр — гейт стримера «Принять/Отклонить»). Только сервер (ключ серверный).
 *
 * Без ключа (mock-клиент / прод без OPENAI_API_KEY) умного судьи нет → CLEAR кроме CSAM: автоблокировки
 * нелегальщины тогда нет (осознанный размен — словарь убран ради отсутствия ложных блоков в игре).
 */
// Мемо вердикта по хэшу текста: префлайт (ДО фандинга эскроу) и серверный create (ПОСЛЕ) должны получить ОДНО
// решение. Без кэша недетерминизм ИИ мог бы пропустить задание на префлайте и заблокировать на create — деньги
// уже в эскроу, задание отклонено (осиротевший эскроу). Кэшируем только окончательные вердикты, не FLAG (сбой
// внешних слоёв — временный, перепроверяем). TTL с запасом на цикл «префлайт → подпись → create» (секунды).
const taskVerdictCache = new Map<string, { verdict: ModerationVerdict; at: number }>();
const TASK_VERDICT_TTL_MS = 10 * 60_000;

export async function classifyTaskText(text: string): Promise<ModerationVerdict> {
  if (isExplicitCsam(text)) return "HARD_BLOCK"; // CSAM — безусловно, контекст игры не оправдывает
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  if (!key) return "CLEAR"; // без ключа умного судьи нет (mock-клиент / прод без ключа)

  const h = hashContent(text);
  const cached = taskVerdictCache.get(h);
  if (cached && Date.now() - cached.at < TASK_VERDICT_TTL_MS) return cached.verdict;

  const mod = await fetchOpenAiModeration(key, text);
  let verdict: ModerationVerdict;
  if (mod && TASK_HARD_CATEGORIES.some((c) => mod.cats[c])) {
    verdict = "HARD_BLOCK";
  } else {
    const legality = await llmTaskLegality(key, text);
    verdict =
      legality === "illegal"
        ? "HARD_BLOCK"
        : mod === null && legality === null
          ? "FLAG" // оба внешних слоя недоступны
          : "CLEAR";
  }
  if (verdict !== "FLAG") taskVerdictCache.set(h, { verdict, at: Date.now() });
  return verdict;
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

function detectLang(text: string): string {
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
