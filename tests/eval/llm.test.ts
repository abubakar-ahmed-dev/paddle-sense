import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  fallbackSentence,
  parseModelJson,
  validateSummary,
  type ModelSummary,
  type SummaryInput,
} from "@/lib/llm";
import { computeStatus } from "@/lib/status";

/**
 * Phase 6 eval set (P6-8, TESTING.md §2 gate): ~50 synthetic river-states ×
 * the validation chain. Legit summaries must pass every gate; adversarial
 * outputs (invented numbers, wrong status, banned tokens, broken JSON) must
 * be caught 100%. Real recorded Gemma outputs are replayed from
 * tests/fixtures/gemma/ (TESTING.md §4) — CI never touches the network.
 *
 * Gate: ≥ 95% of legit state runs pass; 100% of adversarial cases caught.
 */

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    name: "Indus",
    stretch: "Besham stretch (KKH)",
    level: 1632,
    band: { lo: 1498, high: 1849 },
    bandSource: "GloFAS week band (Open-Meteo Flood API)",
    rangeState: "unverified",
    runnable: null,
    status: "range_unverified",
    notes: [],
    cycleDate: "2026-10-09",
    ...overrides,
  };
}

/** Every synthetic state carries the status computeStatus() would produce —
 * the same input the cycle builder feeds the model. */
function state(overrides: Partial<SummaryInput>): SummaryInput {
  const i = input(overrides);
  return {
    ...i,
    status: computeStatus({
      discharge: i.level,
      rangeState: i.rangeState,
      runnable: i.runnable,
    }),
  };
}

const LEVELS: { level: number | null; band: SummaryInput["band"] }[] = [
  { level: 1632, band: { lo: 1498, high: 1849 } },
  { level: 12022, band: { lo: 11000, high: 13000 } },
  { level: 95, band: { lo: 40, high: 120 } },
  { level: 0.1, band: { lo: 0.05, high: 0.4 } },
  { level: null, band: null },
];

function legitStates(): SummaryInput[] {
  const states: SummaryInput[] = [];
  for (const lv of LEVELS) {
    states.push(
      state(lv), // unverified Indus
      state({ ...lv, name: "Malir", rangeState: "not_a_paddling_river", runnable: null }),
      state({ ...lv, name: "Swat", rangeState: "verified", runnable: [40, 400] }),
    );
  }
  return states;
}

/**
 * A "good model" — sentences that only reference snapshot numerals and echo
 * the deterministic status. Proves the gates don't reject honest work.
 */
function faithfulSentence(i: SummaryInput, variant: number): string {
  const q = i.level === null ? "—" : i.level.toLocaleString("en-US");
  const band = i.band
    ? `${i.band.lo.toLocaleString("en-US")}–${i.band.high.toLocaleString("en-US")} m³/s`
    : null;
  switch (i.status) {
    case "in_range": {
      const [lo, hi] = i.runnable ?? [0, 0];
      return variant % 2 === 0
        ? `${i.name} is inside its runnable range (${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} m³/s), with the week band at ${band}.`
        : `${i.name} sits at ${q} m³/s — inside its verified runnable range this cycle.`;
    }
    case "dry":
      return variant % 2 === 0
        ? `${i.name} is at ${q} m³/s, below the week band of ${band}.`
        : `${i.name} is at ${q} m³/s — below its runnable range.`;
    case "high_water_dangerous":
      return variant % 2 === 0
        ? `${i.name} is at ${q} m³/s — above its runnable range. Do not go.`
        : `Do not go on the ${i.name}: ${q} m³/s is above the runnable range this week.`;
    case "range_unverified":
      return variant % 2 === 0
        ? `${i.name} is at ${q} m³/s with a week band near ${band}, but its runnable range is not yet verified — check local sources.`
        : `${i.name} is at ${q} m³/s. Its runnable range is not yet verified — check local sources.`;
    case "not_a_paddling_river":
      return `${i.name} reads ${q} m³/s — a seasonal channel, kept here as an honesty check.`;
    case "no_data":
      return `No reading for ${i.name} yet.`;
  }
}

function modelSummary(sentence: string, status: string, confidence = 0.8): ModelSummary {
  return { sentence, status_word: status, confidence };
}

describe("eval: legit summaries pass the validation chain", () => {
  const states = legitStates();

  it("covers the state matrix (5 water levels × 3 river shapes)", () => {
    expect(states.length).toBe(15);
  });

  it.each(states.map((s, idx) => [`${s.name}/${s.status}`, idx, s] as const))(
    "state %s #%i passes both sentence variants",
    (_label, _idx, s) => {
      for (const variant of [0, 1]) {
        const verdict = validateSummary(
          modelSummary(faithfulSentence(s, variant), s.status),
          s,
        );
        expect(verdict).toEqual({ ok: true });
      }
    },
  );

  it("legit pass rate clears the 95% gate (actually 100%)", () => {
    let pass = 0;
    let total = 0;
    for (const s of states) {
      for (const variant of [0, 1]) {
        total += 1;
        if (validateSummary(modelSummary(faithfulSentence(s, variant), s.status), s).ok) {
          pass += 1;
        }
      }
    }
    expect(total).toBe(30);
    expect(pass / total).toBeGreaterThanOrEqual(0.95);
    expect(pass).toBe(total);
  });
});

describe("eval: adversarial outputs are caught 100%", () => {
  const base = input();

  it.each([
    ["invented level", modelSummary("Indus is at 2,100 m³/s today.", "range_unverified"), "numbers"],
    [
      "rounded band not in input",
      modelSummary("Indus week band is about 1,500–1,850 m³/s.", "range_unverified"),
      "numbers",
    ],
    [
      "percentage not in input",
      modelSummary("Indus is at 1,632 m³/s, which is 80% of its band.", "range_unverified"),
      "numbers",
    ],
    [
      "date numeral not in input",
      modelSummary("Indus was at 1,632 m³/s on 8 October.", "range_unverified"),
      "numbers",
    ],
    ["wrong status word", modelSummary("Indus is at 1,632 m³/s.", "in_range"), "status"],
    [
      "says safe",
      modelSummary("Indus is at 1,632 m³/s — conditions are safe.", "range_unverified"),
      "banned",
    ],
    [
      "says safely",
      modelSummary("Indus is at 1,632 m³/s; rafters can safely float.", "range_unverified"),
      "banned",
    ],
    [
      "says danger-free",
      modelSummary("Indus is at 1,632 m³/s — a danger-free day.", "range_unverified"),
      "banned",
    ],
    [
      "says guaranteed",
      modelSummary("Indus is at 1,632 m³/s, guaranteed runnable.", "range_unverified"),
      "banned",
    ],
    [
      "says unsafe (model must not judge either way)",
      modelSummary("Indus is at 1,632 m³/s — unsafe for beginners.", "range_unverified"),
      "banned",
    ],
  ])("catches %s", (_label, summary, gate) => {
    expect(validateSummary(summary, base)).toEqual({ ok: false, gate });
  });

  it.each([
    ["non-JSON prose", "Indus is flowing nicely today."],
    ["truncated JSON", '{"sentence": "Indus is at 1,632'],
    ["empty object", "{}"],
  ])("catches schema garbage: %s", (_label, raw) => {
    const parsed = parseModelJson(raw);
    expect(validateSummary(parsed, base)).toEqual({ ok: false, gate: "schema" });
  });

  it("missing confidence field fails the schema gate", () => {
    const partial = { sentence: "Indus is at 1,632 m³/s.", status_word: "range_unverified" };
    expect(validateSummary(partial, base)).toEqual({ ok: false, gate: "schema" });
  });

  it("fallback always carries the verbatim danger copy for high water", () => {
    const s = state({ level: 12000, rangeState: "verified", runnable: [40, 400] });
    expect(s.status).toBe("high_water_dangerous");
    expect(fallbackSentence(s.status, s)).toContain("Do not go.");
  });
});

describe("eval: recorded Gemma fixtures replay through the gates", () => {
  const fixtureDir = path.resolve(__dirname, "../fixtures/gemma");
  const fixtures = existsSync(fixtureDir)
    ? ["gemma-pass-indus-unverified-20261009.json", "gemma-fail-unit-relabel-20261009.json"]
        .map((f) => path.join(fixtureDir, f))
        .filter((f) => existsSync(f))
    : [];

  it("has at least one recorded fixture (live validation ran)", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(1);
  });

  it.each(fixtures.map((f) => [path.basename(f), f] as const))(
    "fixture %s matches its expected verdict",
    (_name, file) => {
      const fixture = JSON.parse(readFileSync(file, "utf8")) as {
        input: SummaryInput;
        response: { content: string };
        expect: { verdict: "pass" } | { verdict: "fail"; gate: string };
      };
      const parsed = parseModelJson(fixture.response.content);
      const verdict = validateSummary(parsed, fixture.input);
      if (fixture.expect.verdict === "pass") {
        expect(verdict).toEqual({ ok: true });
      } else {
        expect(verdict).toEqual({ ok: false, gate: fixture.expect.gate });
      }
    },
  );
});
