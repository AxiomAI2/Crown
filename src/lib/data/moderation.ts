/**
 * Moderation pipeline (docs/yellow-paper.md §8). Structure:
 *   [INPUT] → [LANGUAGE] detect → [AUTO] classifier → verdict (+ dedup by hash).
 *
 * The auto layer is pluggable and ASYNCHRONOUS (AutoModerator). By default — a local wordlist (only explicit
 * hard markers). If a server-side OPENAI_API_KEY is set — OpenAI omni-moderation is used (free,
 * multilingual, text+images). resolveAutoModerator() makes the choice by env (the key is server-side, it doesn't
 * reach the browser → the client always uses the wordlist).
 */
import type { ModerationVerdict } from "./types";

export interface AutoModerator {
  classify(text: string, lang: string): Promise<ModerationVerdict>;
}

// POLICY (product decision): individual words and profanity are NOT censored and NOT flagged — that's the
// streamer's taste, they hide manually. The auto layer catches only illegal content → HARD_BLOCK (quarantine +
// escalation to T&S). There is NO default FLAG wordlist. Semantic detection — OpenAI (below); the local list is a
// stub for explicit markers.
const DEFAULT_HARD_LIST = ["csam", "childporn", "child porn", "zoophilia", "hardblock"];

// Explicit CSAM markers — a backstop INDEPENDENT of OpenAI: it underestimates evasive phrasings
// (e.g. "porn under 18" gives sexual/minors≈0.02, whereas "child porn" catches at 0.9).
const CSAM_EXPLICIT =
  /child\S*\s*porn|porn\S*\s*child|underage\S*\s*porn|porn\S*\s*underage|child\s*-?\s*porn|childporn|\bcsam\b|pedophil/i;
// A sign of a minor — NOT on its own, but in COMBINATION with sexual content (sexual ≥ threshold) → CSAM.
// Doesn't catch 18+/"25 years"/"18 years": "18 years" — an adult, "under 18" — a minor.
const MINOR_HINT =
  /under\s*1[0-7]\b|younger\s*than\s*1[0-8]|\b1[0-7]\s*(years?|yo)\b|underage|minor|schoolgirl|\b(child|preteen|teen)\b/i;
const SEXUAL_COMBO_THRESHOLD = 0.3; // above this "sexual" level + a sign of a minor = quarantine

/** Direct explicit CSAM marker — shared by the local and OpenAI moderators. */
function isExplicitCsam(text: string): boolean {
  return CSAM_EXPLICIT.test(text);
}

/** Local auto-moderator: catches hard markers of illegal content/CSAM; lets profanity/any words through (CLEAR). */
const localAutoModerator: AutoModerator = {
  async classify(text) {
    const lower = text.toLowerCase();
    if (isExplicitCsam(text) || DEFAULT_HARD_LIST.some((w) => lower.includes(w)))
      return "HARD_BLOCK";
    return "CLEAR";
  },
};

// Mapping of OpenAI omni-moderation categories → auto-quarantine (HARD_BLOCK).
//  • HARD_ALWAYS — zero tolerance: quarantine at ANY confidence (illegal content, a legal must).
//  • HARD_IF_SEVERE — hard threats/violence: quarantine ONLY at HIGH confidence (by category_scores),
//    so that jokes/banter/"I'll wreck you on the rink" with a low score pass. Raise/lower the SEVERE_THRESHOLD.
//  Everything else (profanity, insults, ordinary hate/sexual) we do NOT ban — the streamer hides it themselves.
const HARD_ALWAYS = ["sexual/minors"] as const;
// Hard threats/violence — quarantine at a HIGH score, with its OWN threshold per category (jokes/gaming banter give
// a low score and pass). Calibrated on examples: a real threat violence≈0.95, harassment/threatening
// ≈0.55-0.74; a joking "I'll wreck you on the rink lol" violence≈0.42, h/threatening≈0.26. Raise thresholds — softer.
const SEVERE_THRESHOLDS: Record<string, number> = {
  violence: 0.8, // "really hard violence"; gaming banter (~0.4) passes
  "violence/graphic": 0.6, // gore/dismemberment
  "harassment/threatening": 0.5, // a targeted threat against a person
  "hate/threatening": 0.5, // a threat on the basis of hatred
};

// — Policy for TASK TEXT (stricter than a crown message): a task is an instruction to ACT, and
//   the platform would be facilitating a crime. So violence/illegal content/threats are blocked by the OpenAI
//   category FLAG (not only at a high score). "Do 50 push-ups" — clear; "kill that guy" — block. —
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

// There is NO keyword-backstop wordlist: it produces false blocks (e.g. "swipe/steal the flag", "raid the base"
// — legal in-game tasks), and slang is endless anyway. Task legality is determined ONLY by the
// semantic AI below (understands context). The single hard exception is the CSAM marker (isExplicitCsam).

// Query to the LLM: "does the task require committing an ILLEGAL act?". Catches slang/euphemisms that the
// moderation endpoint (tuned for "harmful content", not "this is a crime") and a wordlist miss.
const TASK_LEGALITY_PROMPT =
  "You are a moderator of tasks for streamers; a task is paid for with a crown. Tasks that require " +
  "committing an ILLEGAL or dangerous act in the real world are forbidden: theft/shoplifting, violence, threats, " +
  "fraud, vandalism, drugs, unlawful trespassing, harm to people or animals. Allowed are " +
  "harmless ones: sing, dance, play, do push-ups, a reaction, a challenge. Rule when in doubt: better to " +
  "err on the side of caution — if the wording is ambiguous or it's unclear whether it's a real or an in-game act, " +
  "answer ILLEGAL. Answer with ONE word: ILLEGAL or OK.";

/**
 * External auto-moderator on top of OpenAI omni-moderation (free endpoint /v1/moderations). Multilingual.
 * Illegal content (HARD_ALWAYS) → quarantine by flag; hard threats/violence (HARD_IF_SEVERE) → quarantine only
 * when score ≥ SEVERE_THRESHOLD (we don't cut jokes). On failure/timeout — FLAG (we don't block money, don't auto-
 * publish — text goes to HELD for a manual decision). Server only (the key is server-side).
 */
interface OpenAiModeration {
  cats: Record<string, boolean>;
  scores: Record<string, number>;
}

/** A single request to OpenAI omni-moderation. null — couldn't check (failure/timeout/non-OK). Server only. */
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
      console.error("[moderation] OpenAI returned", res.status);
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
    console.error("[moderation] OpenAI error:", e);
    return null;
  }
}

/**
 * External auto-moderator on top of OpenAI omni-moderation. CROWN-MESSAGE policy: illegal content
 * (HARD_ALWAYS) → quarantine by flag; hard threats/violence — only when score ≥ SEVERE_THRESHOLD (jokes
 * pass). On failure — FLAG (text goes to HELD for a manual decision, we don't touch money).
 */
function createOpenAiModerator(apiKey: string): AutoModerator {
  return {
    async classify(text) {
      if (isExplicitCsam(text)) return "HARD_BLOCK"; // explicit CSAM — before the request
      const r = await fetchOpenAiModeration(apiKey, text);
      if (!r) return "FLAG";
      if (HARD_ALWAYS.some((c) => r.cats[c])) return "HARD_BLOCK"; // illegal content — at any confidence
      // CSAM combo: OpenAI underestimates sexual/minors on evasive phrasings, but gives a high sexual.
      if ((r.scores["sexual"] ?? 0) >= SEXUAL_COMBO_THRESHOLD && MINOR_HINT.test(text)) {
        return "HARD_BLOCK";
      }
      if (Object.entries(SEVERE_THRESHOLDS).some(([c, t]) => (r.scores[c] ?? 0) >= t)) {
        return "HARD_BLOCK"; // hard threat/violence at a high score
      }
      return "CLEAR"; // profanity/jokes/ordinary negativity — let through, the streamer hides it manually
    },
  };
}

// Access to models may be closed off (a restricted key without the model.request scope → 401, or no billing).
// Then we temporarily disable the LLM check (COOLDOWN, not forever — B6): a transient 401/403 must not silence the
// legality layer until a restart. When the cooldown expires we try again ourselves → self-recovery.
const LLM_LEGALITY_COOLDOWN_MS = 10 * 60_000; // 10 min
let llmLegalityCooldownUntil = 0;

/** LLM classifier of task legality (gpt-4o-mini, cheap). null — couldn't check. Server only. */
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
        "[moderation] LLM legality check unavailable (key without model access) — pausing for 10 min",
      );
      return null;
    }
    if (!res.ok) {
      console.error("[moderation] legality LLM returned", res.status);
      return null;
    }
    const out =
      ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]
        ?.message?.content ?? "";
    return /illegal/i.test(out) ? "illegal" : "ok";
  } catch (e) {
    console.error("[moderation] legality LLM error:", e);
    return null;
  }
}

/**
 * Moderation of TASK TEXT (escrow-task): stricter than a crown message, since a task is PAID FOR and the platform
 * would be facilitating the act. Judged by the semantic AI, without a keyword wordlist (it falsely blocked legal
 * in-game "steal/swipe/rob …"). Layers: (1) the hard CSAM marker — the only unconditional block;
 * (2) OpenAI omni-moderation — block by a dangerous-category flag; (3) the LLM check "is this a call to an illegal
 * act?" — catches slang/euphemisms like "swipe some milk from the store", understanding context. Any layer says
 * "no" → HARD_BLOCK (the task isn't created). Both external layers couldn't check → FLAG (we don't cut creation
 * hard: the final filter is the streamer's "Accept/Reject" gate). Server only (the key is server-side).
 *
 * Without a key (mock client / prod without OPENAI_API_KEY) there is no smart judge → CLEAR except CSAM: there's
 * then no auto-block of illegal content (a conscious trade-off — the wordlist was removed to avoid false blocks in the game).
 */
// Verdict memo by text hash: the preflight (BEFORE funding the escrow) and the server create (AFTER) must get ONE
// decision. Without the cache, AI non-determinism could let a task pass at preflight and block it at create — the money
// is already in escrow, the task rejected (an orphaned escrow). We cache only final verdicts, not FLAG (an external-
// layer failure is temporary, we recheck). TTL with headroom for the "preflight → sign → create" cycle (seconds).
const taskVerdictCache = new Map<string, { verdict: ModerationVerdict; at: number }>();
const TASK_VERDICT_TTL_MS = 10 * 60_000;
// R6 pattern: the TTL is checked on read and does NOT free memory — without a cap the Map would grow unbounded.
const TASK_VERDICT_CACHE_CAP = 5000;

export async function classifyTaskText(text: string): Promise<ModerationVerdict> {
  if (isExplicitCsam(text)) return "HARD_BLOCK"; // CSAM — unconditionally, the game context is no excuse
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  if (!key) return "CLEAR"; // without a key there is no smart judge (mock client / prod without a key)

  const h = await hashContent(text);
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
          ? "FLAG" // both external layers are unavailable
          : "CLEAR";
  }
  if (verdict !== "FLAG") {
    taskVerdictCache.set(h, { verdict, at: Date.now() });
    while (taskVerdictCache.size > TASK_VERDICT_CACHE_CAP) {
      const oldest = taskVerdictCache.keys().next().value;
      if (oldest === undefined) break;
      taskVerdictCache.delete(oldest); // oldest by insertion order (like MOD_CACHE_CAP)
    }
  }
  return verdict;
}

// Auto-moderator selection by server env (memoized). OPENAI_API_KEY is a server-side variable (NOT
// NEXT_PUBLIC), it doesn't reach the browser bundle → in the mock/api client it's always the local wordlist.
let cachedModerator: AutoModerator | null = null;
export function resolveAutoModerator(): AutoModerator {
  if (cachedModerator) return cachedModerator;
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  cachedModerator = key ? createOpenAiModerator(key) : localAutoModerator;
  return cachedModerator;
}

function detectLang(text: string): string {
  if (/[¡¿]|gracias|directo/i.test(text)) return "es";
  if (/\p{Script=Cyrillic}/iu.test(text)) return "ru";
  return "en";
}

/**
 * Cryptographically strong hash of normalized content (SHA-256, full) — the onchain anchor of the text (memo.m) and
 * the dedup/moderation-cache key. Crypto is MANDATORY: memo.m is the commitment "the donor signed exactly this text",
 * and by it the server binds submitted text to someone else's donation (ingest). The former FNV-1a (32 bits) gave an
 * instant second preimage → for any malicious text a tail could be found to fit someone else's memo.m (substituting
 * text under a victim's address) and to collide with a cached CLEAR (bypassing auto-moderation). Async: Web Crypto
 * (globalThis.crypto.subtle) — one and the same in the browser (chain-provider) and on the server (ingest/moderation).
 */
export async function hashContent(text: string): Promise<string> {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Onchain commitment of TASK TEXT (CR-4): `SHA-256(nonceHex ‖ text)` — 32 bytes, hex. `nonceHex` is fixed-length
 * (16 bytes = 32 hex chars), so concatenation without a separator is unambiguous. The CLIENT puts this value
 * as `task_id` (the escrow-PDA seed) when funding, so the onchain escrow address itself becomes a
 * commitment to the text — without changing the program/redeploying. Differences from `hashContent`: (1) we do NOT
 * normalize — we commit the exact text the jury reads; (2) the `nonce` salt (stored offchain with the text) defeats
 * brute-forcing low-entropy tasks via the public hash. Verification: anyone with the pair (text, nonce) recomputes and
 * checks against the onchain `task_id` → the operator can neither substitute nor slip in someone else's text unnoticed.
 */
export async function taskTextCommitment(text: string, nonceHex: string): Promise<string> {
  const payload = new TextEncoder().encode(`${nonceHex}${text}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Spam filter "Remove links" (ChannelConfig.removeLinks): scheme/www URLs, then bare domains — a dot-separated
// label chain ending in a TLD (2–24 LATIN letters, or "рф"), with an optional /path tail. The latin-or-рф TLD is
// what keeps prose with dots intact ("т.е.", "ул.Ленина" — cyrillic after the dot → not a link). Deliberately
// eager on real links (t.me/x, bit.ly, пример.рф) — the owner opted in; a missed link is worse than an over-strip.
const LINK_SCHEME_RE = /(?:https?:\/\/|www\.)\S+/gi;
const LINK_DOMAIN_RE =
  /(?:^|(?<=[\s(«"']))[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?(?:\.[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?)*\.(?:[a-z]{2,24}|рф)(?:\/\S*)?(?=[\s)»"'.,!?:;]|$)/giu;

/**
 * Best-effort link removal from crown text (Moderation → Remove links). Runs at ingest, AFTER the chain
 * memo-hash check (ingest verifies the text the donor signed; what we PUBLISH is the realm's call).
 * Whitespace left behind is collapsed; text that was only a link collapses to "".
 */
export function stripLinks(text: string): string {
  return text.replace(LINK_SCHEME_RE, "").replace(LINK_DOMAIN_RE, "").replace(/\s+/g, " ").trim();
}

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  lang: string;
  contentHash: string;
  deduped: boolean; // true → decision taken from the cache (repeated content), without re-review/re-report
}

/**
 * Run text through the pipeline with dedup. Dedup is WITHIN a realm (`scope`): a repeat of the same content
 * on ONE realm is taken from the cache (flooding collapses to O(1), without re-review/re-report), but the first
 * appearance on each realm is reviewed and reported separately — each streamer has their own T&S queue.
 */
export async function runPipeline(
  text: string,
  cache: Map<string, ModerationVerdict>,
  opts?: { scope?: string; auto?: AutoModerator },
): Promise<ModerationOutcome> {
  const contentHash = await hashContent(text);
  const lang = detectLang(text);
  const key = opts?.scope ? `${opts.scope}:${contentHash}` : contentHash;
  const cached = cache.get(key);
  if (cached) return { verdict: cached, lang, contentHash, deduped: true };
  const verdict = await (opts?.auto ?? localAutoModerator).classify(text, lang);
  cache.set(key, verdict);
  return { verdict, lang, contentHash, deduped: false };
}
