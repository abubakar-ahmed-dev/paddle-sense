// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import {
  chatSummary,
  fallbackSentence,
  summarizeRiver,
} from "@/lib/llm";
import {
  getLatestForecastRun,
  getLatestSummary,
  insertSummaryIfMissing,
  insertPredictions,
  upsertReadings,
} from "@/lib/db";
import { RIVERS } from "@/lib/rivers";
import { POST as summarizeRoute } from "@/app/api/internal/summarize/route";

/**
 * Phase 6 integration tests against a REAL Postgres (ephemeral Docker,
 * scripts/test-db.mjs). No live LLM calls — the model is an injected
 * fetcher returning recorded-shaped chat/completions bodies (TESTING.md §1).
 * Readings are seeded for "today" so buildSummaryInput stays on the DB path
 * and never reaches for the live Flood API.
 */
const url = process.env.DATABASE_TEST_URL;
const TODAY = new Date().toISOString().slice(0, 10);

type ChatBody = { content: string };

function chatFetcher(response: ChatBody | Error) {
  const calls: string[] = [];
  const fetcher = async (fetchUrl: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    calls.push(fetchUrl);
    if (response instanceof Error) throw response;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: response.content } }],
        usage: { prompt_tokens: 120, completion_tokens: 24 },
      }),
    };
  };
  return { calls, fetcher };
}

// Indus is owner-verified [55, 120] since 2026-10-12 — at the fixture level
// (1,632 m³/s) the deterministic status is high_water_dangerous, so the fake
// model output must echo THAT word (gate 3) or it is rightly discarded.
const VALID_OUTPUT: ChatBody = {
  content: JSON.stringify({
    sentence: "Indus is at 1,632 m³/s — above its runnable range. Do not go.",
    status_word: "high_water_dangerous",
    confidence: 0.82,
  }),
};

describe.skipIf(!url)("summaries + summary cycle (real Postgres)", () => {
  beforeAll(async () => {
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
    // Fresh readings keep the cycle on the DB path (no live Flood API).
    await upsertReadings(
      RIVERS.map((r) => ({
        riverId: r.id,
        date: TODAY,
        kind: "observed" as const,
        discharge: r.id === "indus-besham" ? 1631.7 : r.id === "malir-karachi" ? 0.09 : 210.0,
        source: "test",
      })),
    );
  });

  it("insertSummaryIfMissing is idempotent per (river, cycle_date)", async () => {
    const row = {
      riverId: "kunhar-balakot",
      cycleDate: "2099-01-01",
      text: "Kunhar is at 210 m³/s. Its runnable range is not yet verified — check local sources.",
      statusWord: "range_unverified",
      generatedBy: "gemma-test",
      validated: true,
    };
    expect(await insertSummaryIfMissing(row)).toBe(true);
    expect(await insertSummaryIfMissing(row)).toBe(false);
    const latest = await getLatestSummary("kunhar-balakot");
    expect(latest?.cycleDate).toBe("2099-01-01");
    expect(latest?.generatedBy).toBe("gemma-test");
  });

  it("getLatestSummary returns the newest cycle across rows", async () => {
    await insertSummaryIfMissing({
      riverId: "kunhar-balakot",
      cycleDate: "2098-12-25",
      text: "older sentence",
      statusWord: "range_unverified",
      generatedBy: "fallback-row-test",
      validated: false,
    });
    const latest = await getLatestSummary("kunhar-balakot");
    expect(latest?.cycleDate).toBe("2099-01-01");
  });

  it("getLatestForecastRun collapses the newest run to a week envelope", async () => {
    await insertPredictions(
      [1, 2, 3].map((d) => ({
        riverId: "kunhar-balakot",
        targetDate: `2099-02-0${d}`,
        bandLo: 10 * d,
        bandHigh: 100 + d,
        coverageTarget: 0.9,
        modelVersion: "tabpfn-test-v1",
        kind: "forecast" as const,
      })),
    );
    await new Promise((r) => setTimeout(r, 20)); // distinct created_at for run 2
    await insertPredictions([
      {
        riverId: "kunhar-balakot",
        targetDate: "2099-02-05",
        bandLo: 25,
        bandHigh: 90,
        coverageTarget: 0.9,
        modelVersion: "tabpfn-test-v2",
        kind: "forecast",
      },
    ]);
    const run = await getLatestForecastRun("kunhar-balakot");
    expect(run?.modelVersion).toBe("tabpfn-test-v2");
    expect(run?.bandLo).toBe(25);
    expect(run?.bandHigh).toBe(90);
  });

  it("summarizeRiver stores a validated model sentence, then serves it from cache", async () => {
    const { calls, fetcher } = chatFetcher(VALID_OUTPUT);
    const first = await summarizeRiver(RIVERS[0], { fetcher, apiKey: "test", model: "gemma-test", today: TODAY });
    expect(first.generatedBy).toBe("model");
    expect(first.validated).toBe(true);
    expect(first.stored).toBe(true);
    expect(first.sentence).toContain("1,632");
    expect(first.promptTokens).toBe(120);
    expect(calls.length).toBe(1);

    const second = await summarizeRiver(RIVERS[0], { fetcher, apiKey: "test", model: "gemma-test", today: TODAY });
    expect(second.generatedBy).toBe("cache");
    expect(second.sentence).toBe(first.sentence);
    expect(calls.length).toBe(1); // zero extra LLM spend (P6-7)

    const stored = await getLatestSummary("indus-besham");
    expect(stored?.statusWord).toBe("high_water_dangerous");
  });

  it("provider failure stores nothing and returns the §6 fallback", async () => {
    const { fetcher } = chatFetcher(new Error("connection refused"));
    const result = await summarizeRiver(RIVERS[2], {
      fetcher,
      apiKey: "test",
      model: "gemma-test",
      today: TODAY,
    });
    expect(result.generatedBy).toBe("fallback");
    expect(result.stored).toBe(false);
    expect(result.sentence).toBe(
      fallbackSentence("range_unverified", {
        name: "Swat",
        level: 210,
        runnable: null,
      }),
    );
    expect(await getLatestSummary("swat-mingora")).toBeNull();
  });

  it("a banned-token output is discarded before storage (SM1)", async () => {
    const { fetcher } = chatFetcher({
      content: JSON.stringify({
        sentence: "Swat is at 210 m³/s — conditions are safe.",
        status_word: "range_unverified",
        confidence: 0.9,
      }),
    });
    const result = await summarizeRiver(RIVERS[2], {
      fetcher,
      apiKey: "test",
      model: "gemma-test",
      today: TODAY,
    });
    expect(result.generatedBy).toBe("fallback");
    expect(result.error).toBe("validation: banned");
    expect(await getLatestSummary("swat-mingora")).toBeNull();
  });

  it("an invented number is discarded (validation: numbers)", async () => {
    const { fetcher } = chatFetcher({
      content: JSON.stringify({
        sentence: "Swat is at 9,999 m³/s.",
        status_word: "range_unverified",
        confidence: 0.9,
      }),
    });
    const result = await summarizeRiver(RIVERS[2], {
      fetcher,
      apiKey: "test",
      model: "gemma-test",
      today: TODAY,
    });
    expect(result.generatedBy).toBe("fallback");
    expect(result.error).toBe("validation: numbers");
  });

  it("adapter surfaces provider status without the key", async () => {
    const fetcher = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      chatSummary({} as never, { fetcher, apiKey: "secret-key", model: "m" }),
    ).rejects.toThrow("LLM request failed with status 503");
  });

  it("POST /api/internal/summarize rejects missing/wrong token with the §0 shape", async () => {
    process.env.X_INTERNAL_TOKEN = "phase6-test-token";
    const makeReq = (token?: string) =>
      new NextRequest("http://localhost/api/internal/summarize", {
        method: "POST",
        headers: token ? { "x-internal-token": token } : {},
      });
    const noToken = await summarizeRoute(makeReq());
    expect(noToken.status).toBe(401);
    const wrongToken = await summarizeRoute(makeReq("nope"));
    expect(wrongToken.status).toBe(401);
    const body = await wrongToken.json();
    expect(body.error.code).toBe("unauthorized");
  });
});
