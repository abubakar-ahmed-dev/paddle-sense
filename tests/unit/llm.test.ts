import { describe, it, expect } from "vitest";
import {
  BANNED_TOKENS,
  buildPrompt,
  chatSummary,
  fallbackSentence,
  fmtLevel,
  normalizeNumeral,
  numeralsIn,
  parseModelJson,
  roundLevel,
  validateSummary,
  type SummaryInput,
} from "@/lib/llm";

/**
 * Unit tests for the Phase 6 validation chain (P6-5), fallback templates
 * (UX_SPEC §6 verbatim), and the tolerant JSON parse (P6-2). Every gate is
 * fired by its own adversarial case; a valid summary passes through.
 */

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    name: "Indus",
    stretch: "Besham stretch (KKH)",
    level: 1632,
    band: { lo: 1498, high: 1849 },
    bandSource: "TabPFN tabpfn-v1 forecast run 2026-10-08 (7-day envelope)",
    rangeState: "unverified",
    runnable: null,
    status: "range_unverified",
    notes: ["Put-in near the KKH bridge; operators run in summer."],
    cycleDate: "2026-10-09",
    ...overrides,
  };
}

function validSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sentence: "Indus is at 1,632 m³/s. Its runnable range is not yet verified — check local sources.",
    status_word: "range_unverified",
    confidence: 0.8,
    ...overrides,
  };
}

describe("numeral normalization (P6-5 comma handling)", () => {
  it("treats comma-grouped and plain digits as the same number", () => {
    expect(normalizeNumeral("1,632")).toBe("1632");
    expect(normalizeNumeral("1632")).toBe("1632");
    expect(normalizeNumeral("0.10")).toBe("0.1");
  });

  it("extracts numerals from a sentence", () => {
    expect(numeralsIn("Indus is at 1,632 m³/s near the KKH bridge (34.88 N).")).toEqual([
      "1632",
      "34.88",
    ]);
  });
});

describe("validateSummary gates", () => {
  it("accepts a valid, honest summary", () => {
    expect(validateSummary(validSummary(), input())).toEqual({ ok: true });
  });

  it("gate schema: rejects non-objects, missing/empty sentence, bad confidence", () => {
    expect(validateSummary(null, input())).toEqual({ ok: false, gate: "schema" });
    expect(validateSummary("sentence", input())).toEqual({ ok: false, gate: "schema" });
    expect(
      validateSummary({ status_word: "range_unverified", confidence: 0.5 }, input()),
    ).toEqual({ ok: false, gate: "schema" });
    expect(
      validateSummary(
        { sentence: "  ", status_word: "range_unverified", confidence: 0.5 },
        input(),
      ),
    ).toEqual({ ok: false, gate: "schema" });
    expect(validateSummary(validSummary({ confidence: "high" }), input())).toEqual({
      ok: false,
      gate: "schema",
    });
    expect(validateSummary(validSummary({ confidence: 1.5 }), input())).toEqual({
      ok: false,
      gate: "schema",
    });
  });

  it("gate numbers: rejects a numeral that exists nowhere in the input", () => {
    expect(
      validateSummary(validSummary({ sentence: "Indus reads about 2,100 m³/s today." }), input()),
    ).toEqual({ ok: false, gate: "numbers" });
  });

  it("gate numbers: comma-formatted copies of input numbers pass", () => {
    expect(
      validateSummary(
        validSummary({ sentence: "Indus is at 1,632 m³/s; next week's band is 1,498–1,849 m³/s." }),
        input(),
      ),
    ).toEqual({ ok: true });
  });

  it("gate numbers: numerals inside input note strings are part of the universe", () => {
    const i = input({ notes: ["Operators run trips rated at class 3."] });
    expect(
      validateSummary(
        validSummary({ sentence: "Indus water is usually run by operators on trips rated at class 3." }),
        i,
      ),
    ).toEqual({ ok: true });
  });

  it("gate numbers: rejects the live-observed cfs relabel (digits honest, unit a lie)", () => {
    expect(
      validateSummary(
        validSummary({ sentence: "The runnable range is not yet verified. The discharge is 1632 cfs." }),
        input(),
      ),
    ).toEqual({ ok: false, gate: "numbers" });
  });

  it("gate status: rejects a status_word that is not the computed one", () => {
    expect(
      validateSummary(validSummary({ status_word: "in_range" }), input()),
    ).toEqual({ ok: false, gate: "status" });
  });

  it("gate banned: rejects safe, safely, danger-free, guaranteed, unsafe, safest", () => {
    for (const word of ["safe", "safely", "danger-free", "guaranteed", "unsafe", "safest"]) {
      const sentence = `Indus is at 1,632 m³/s and conditions look ${word}.`;
      expect(validateSummary(validSummary({ sentence }), input())).toEqual({
        ok: false,
        gate: "banned",
      });
      expect(BANNED_TOKENS.test(sentence)).toBe(true);
    }
  });
});

describe("parseModelJson (tolerant, P6-2)", () => {
  const body = '{"sentence":"x","status_word":"dry","confidence":0.5}';

  it("parses bare JSON", () => {
    expect(parseModelJson(body)).toEqual({ sentence: "x", status_word: "dry", confidence: 0.5 });
  });

  it("parses fenced JSON (```json blocks)", () => {
    expect(parseModelJson("```json\n" + body + "\n```")).toEqual({
      sentence: "x",
      status_word: "dry",
      confidence: 0.5,
    });
  });

  it("parses JSON wrapped in prose", () => {
    expect(parseModelJson("Here you go:\n" + body + "\nHope that helps!")).toEqual({
      sentence: "x",
      status_word: "dry",
      confidence: 0.5,
    });
  });

  it("returns null for broken or missing JSON", () => {
    expect(parseModelJson("no braces here")).toBeNull();
    expect(parseModelJson("{broken")).toBeNull();
  });

  it("strips Gemma <thought> blocks before the answer JSON (measured live)", () => {
    const thoughtAndAnswer =
      '<thought>*   Constraint 3: numbers only.\n    *   band: {"lo": 1498, "high": 1849}\n    Result:\n    {"sentence":"s","status_word":"dry","confidence":0.9}</thought>{"sentence":"s","status_word":"dry","confidence":0.9}';
    expect(parseModelJson(thoughtAndAnswer)).toEqual({
      sentence: "s",
      status_word: "dry",
      confidence: 0.9,
    });
  });

  it("handles thought block followed by a fenced answer", () => {
    const fenced =
      '<thought>thinking with {"braces": 1} inside</thought>```json\n{"sentence":"s","status_word":"dry","confidence":1}\n```';
    expect(parseModelJson(fenced)).toEqual({
      sentence: "s",
      status_word: "dry",
      confidence: 1,
    });
  });

  it("a truncated thought that still parses fails the schema gate downstream", () => {
    // Ran out of tokens mid-answer: the only complete object is a band fragment.
    const truncated = '<thought>*   band: {"lo": 1498, "high": 1849}</thought>';
    const parsed = parseModelJson(truncated);
    expect(validateSummary(parsed, input())).toEqual({ ok: false, gate: "schema" });
  });
});

describe("chatSummary adapter (fixture fetcher, no live calls)", () => {
  const snapshot = input();

  it("returns the parsed summary plus token usage", async () => {
    const calls: { url: string; body: string; auth: string | undefined }[] = [];
    const fetcher = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"sentence":"s","status_word":"range_unverified","confidence":0.7}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    };
    const res = await chatSummary(snapshot, { fetcher, apiKey: "test", model: "m" });
    expect(res.summary).toEqual({
      sentence: "s",
      status_word: "range_unverified",
      confidence: 0.7,
    });
    expect(res.promptTokens).toBe(100);
    expect(res.completionTokens).toBe(20);
    // OpenAI-compatible chat/completions on the mapped provider; key in header only
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(calls[0].body).toContain('"model":"m"');
    expect(calls[0].auth).toBe("Bearer test");
    expect(calls[0].body).toContain("Indus");
  });

  it("surfaces provider errors without the API key in the message", async () => {
    const fetcher = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(
      chatSummary(snapshot, { fetcher, apiKey: "secret-key", model: "m" }),
    ).rejects.toThrow("LLM request failed with status 429");
  });

  it("keeps the prompt single-turn with the full snapshot embedded", () => {
    const prompt = buildPrompt(snapshot);
    expect(prompt).toContain('"status": "range_unverified"');
    expect(prompt).toContain("Never use these words");
    expect(prompt).toContain("1632");
  });
});

describe("fallbackSentence (UX_SPEC §6 verbatim)", () => {
  it("in_range uses the runnable range with an en dash", () => {
    expect(
      fallbackSentence("in_range", { name: "Kunhar", level: 95, runnable: [40, 120] }),
    ).toBe("Kunhar is inside its runnable range (40.00–120 m³/s).");
  });

  it("dry", () => {
    expect(fallbackSentence("dry", { name: "Indus", level: 632.5 })).toBe(
      "Indus is at 633 m³/s — below its runnable range.",
    );
  });

  it("high_water_dangerous says do not go", () => {
    expect(fallbackSentence("high_water_dangerous", { name: "Indus", level: 12022 })).toBe(
      "Indus is at 12,022 m³/s — above its runnable range. Do not go.",
    );
  });

  it("range_unverified", () => {
    expect(fallbackSentence("range_unverified", { name: "Swat", level: 210.04 })).toBe(
      "Swat is at 210 m³/s. Its runnable range is not yet verified — check local sources.",
    );
  });

  it("not_a_paddling_river keeps the honesty-check framing", () => {
    expect(fallbackSentence("not_a_paddling_river", { name: "Malir", level: 0.1 })).toBe(
      "Malir reads 0.10 m³/s — a seasonal channel, kept here as an honesty check.",
    );
  });

  it("no_data never shows a number", () => {
    expect(fallbackSentence("no_data", { name: "Malir", level: null })).toBe(
      "No reading for Malir yet.",
    );
  });
});

describe("formatting helpers", () => {
  it("roundLevel matches §3 display formats", () => {
    expect(roundLevel(1631.7)).toBe(1632);
    expect(roundLevel(14.234)).toBe(14.23);
    expect(roundLevel(0.104)).toBe(0.1);
  });

  it("fmtLevel: thousands separators ≥ 100, two decimals < 100", () => {
    expect(fmtLevel(12021.64)).toBe("12,022");
    expect(fmtLevel(95)).toBe("95.00");
  });
});
