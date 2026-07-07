import { describe, expect, it } from "vitest";
import { classifyTaskText, hashContent, stripLinks } from "./moderation";

/**
 * Test of TASK TEXT moderation (escrow-task). The keyword-backstop wordlist was REMOVED (it produced false blocks
 * on legal in-game "steal/swipe/rob …"). Task legality is judged by the semantic AI (OpenAI),
 * which is NOT run here — the test environment has no OPENAI_API_KEY. So offline we only check the
 * deterministic contract: the unconditional CSAM block and the absence of false blocks without a key.
 */
describe("classifyTaskText — offline (no OpenAI key)", () => {
  it("explicit CSAM marker → HARD_BLOCK (unconditionally, the game context is no excuse)", async () => {
    for (const t of ["child porn", "childporn", "csam", "pedophile"]) {
      expect(await classifyTaskText(t)).toBe("HARD_BLOCK");
    }
  });

  it("without a key there is no smart judge → non-CSAM returns CLEAR (no false blocks)", async () => {
    // In-game phrasings that the former wordlist falsely blocked — now they pass.
    for (const t of ["steal the flag from the enemies", "swipe the base in dota", "rob the enemy camp"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
    // Ordinary harmless tasks — also CLEAR.
    for (const t of ["dance a jig", "do 50 push-ups", "sing a song", "show your setup"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
  });
});

describe("hashContent — cryptographically strong SHA-256 (onchain text anchor + moderation key)", () => {
  it("matches the reference SHA-256 of the normalized text", async () => {
    // Known vector: sha256("abc"). It used to be FNV-1a 32 bits (8 hex) → an instant second preimage:
    // substituting text under someone else's memo.m and colliding with a cached CLEAR. Now full SHA-256.
    expect(await hashContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("normalizes case/whitespace (trim + lowercase + collapse)", async () => {
    expect(await hashContent("  Hello   World  ")).toBe(await hashContent("hello world"));
  });
  it("64 hex; different texts → different hashes", async () => {
    const h = await hashContent("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashContent("hello!")).not.toBe(h);
  });
});

describe("stripLinks — spam filter «Remove links» (ChannelConfig.removeLinks)", () => {
  it("strips scheme/www URLs, keeping the surrounding text", () => {
    expect(stripLinks("check https://evil.example/promo?x=1 out")).toBe("check out");
    expect(stripLinks("go to www.spam.site now")).toBe("go to now");
  });
  it("strips bare domains with and without a path (t.me/x, bit.ly, example.com)", () => {
    expect(stripLinks("join t.me/scamchan for gifts")).toBe("join for gifts");
    expect(stripLinks("bit.ly/3xYzAbC")).toBe("");
    expect(stripLinks("my site example.com, welcome!")).toBe("my site , welcome!");
    expect(stripLinks("сайт пример.рф зацени")).toBe("сайт зацени");
  });
  it("does not touch prose with dots (т.е., ул.Ленина, versions, sentence ends)", () => {
    expect(stripLinks("т.е. всё хорошо")).toBe("т.е. всё хорошо");
    expect(stripLinks("живу на ул.Ленина")).toBe("живу на ул.Ленина");
    expect(stripLinks("gg. nice stream")).toBe("gg. nice stream");
  });
  it("text that was only a link collapses to empty (→ treated as a textless crown)", () => {
    expect(stripLinks("https://spam.example")).toBe("");
    expect(stripLinks("  www.spam.example  ")).toBe("");
  });
  it("collapses the whitespace left behind", () => {
    expect(stripLinks("a https://x.example b   c")).toBe("a b c");
  });
});
