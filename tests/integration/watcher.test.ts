// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execSync } from "node:child_process";
import postgres from "postgres";
import {
  bootGate,
  notifyRiver,
  predictRiver,
  type NotifyResult,
  type PredictResult,
} from "../../workers/activities";
import {
  insertSummaryIfMissing,
  upsertReadings,
} from "@/lib/db";
import { RIVERS } from "@/lib/rivers";
import type { NotifyFetcher } from "@/lib/notify";

/**
 * Phase 7 integration tests (P7-4/P7-5/P7-6) against real Postgres — the
 * master-plan gate "double-run → no duplicate rows" at the activity level.
 * No live APIs: the predict service and Resend are injected fetchers, and
 * the archive weather payload is injected (TESTING.md §1).
 */
const url = process.env.DATABASE_TEST_URL;
const TODAY = new Date().toISOString().slice(0, 10);

const FAKE_ARCHIVE = { time: [TODAY], rain_mm: [0], temp_mean_c: [0] };

function predictFetcher() {
  const calls: string[] = [];
  const fetcher = (async (fetchUrl: string) => {
    calls.push(fetchUrl);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model_version: "tabpfn-test",
        days: [{ date: "2099-07-02", band_lo: 10, band_high: 20 }],
      }),
    };
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function emailFetcher() {
  const bodies: string[] = [];
  const fetcher: NotifyFetcher = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200, json: async () => ({ id: "email-x" }) };
  };
  return { bodies, fetcher };
}

describe.skipIf(!url)("watcher activities (real Postgres)", () => {
  const envSnapshot = { ...process.env };

  beforeAll(async () => {
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
    await upsertReadings(
      RIVERS.map((r) => ({
        riverId: r.id,
        date: TODAY,
        kind: "observed" as const,
        discharge: 100.0,
        source: "test",
      })),
    );
  });

  afterAll(async () => {
    // Hermetic cleanup: other integration files assert on shared rivers'
    // newest rows; remove exactly what this file added.
    const sql = postgres(url!, { connect_timeout: 15, max: 1 });
    try {
      await sql`DELETE FROM predictions WHERE model_version = 'tabpfn-test'`;
      await sql`DELETE FROM summaries WHERE cycle_date IN ('2099-06-01','2099-06-02')`;
      await sql`DELETE FROM readings WHERE source = 'test' AND date = ${TODAY}`;
    } finally {
      await sql.end();
    }
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("predictRiver double-run creates exactly one forecast run (P7-4)", async () => {
    process.env.PREDICT_URL = "http://predict.test";
    process.env.X_INTERNAL_TOKEN = "test-token";
    const { calls, fetcher } = predictFetcher();

    // swat: llm.test creates kunhar forecast runs; skip-if-today must see none here
    const first: PredictResult = await predictRiver("swat-mingora", {
      fetcher,
      archiveWeather: FAKE_ARCHIVE,
    });
    expect(first.predicted).toBe(true);
    expect(first.modelVersion).toBe("tabpfn-test");
    expect(calls).toHaveLength(1);

    const second = await predictRiver("swat-mingora", {
      fetcher,
      archiveWeather: FAKE_ARCHIVE,
    });
    expect(second.predicted).toBe(false);
    expect(second.skipped).toBe("forecast run already exists for today");
    expect(calls).toHaveLength(1); // predict service never called again
  });

  it("notifyRiver emails only a fresh transition into range (P7-5)", async () => {
    await insertSummaryIfMissing({
      riverId: "kunhar-balakot",
      cycleDate: "2099-06-01",
      text: "Kunhar is at 100 m³/s — below its runnable range.",
      statusWord: "dry",
      generatedBy: "test",
      validated: true,
    });
    await insertSummaryIfMissing({
      riverId: "kunhar-balakot",
      cycleDate: "2099-06-02",
      text: "Kunhar is inside its runnable range (40–120 m³/s).",
      statusWord: "in_range",
      generatedBy: "test",
      validated: true,
    });
    const { bodies, fetcher } = emailFetcher();
    process.env.NOTIFY_EMAIL_PROVIDER = "resend";
    process.env.NOTIFY_EMAIL_KEY = "test-key";
    process.env.NOTIFY_EMAIL_TO = "owner@example.com";

    const sent: NotifyResult = await notifyRiver(
      { riverId: "kunhar-balakot", summaryStored: true },
      { fetcher, today: TODAY },
    );
    expect(sent.sent).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("in its runnable range");
    expect(bodies[0]).toContain("never"); // honesty footer present

    // cache/rerun path: no fresh row this cycle → no email, ever
    const rerun = await notifyRiver(
      { riverId: "kunhar-balakot", summaryStored: false },
      { fetcher, today: TODAY },
    );
    expect(rerun).toEqual({
      riverId: "kunhar-balakot",
      sent: false,
      skipped: "no fresh summary this cycle",
    });
    expect(bodies).toHaveLength(1);
  });

  it("notifyRiver skips without a transition or a current row", async () => {
    // already in range → no crossing claimed
    await insertSummaryIfMissing({
      riverId: "swat-mingora",
      cycleDate: "2099-06-01",
      text: "in range already",
      statusWord: "in_range",
      generatedBy: "test",
      validated: true,
    });
    await insertSummaryIfMissing({
      riverId: "swat-mingora",
      cycleDate: "2099-06-02",
      text: "still in range",
      statusWord: "in_range",
      generatedBy: "test",
      validated: true,
    });
    const { bodies, fetcher } = emailFetcher();
    const noCrossing = await notifyRiver(
      { riverId: "swat-mingora", summaryStored: true },
      { fetcher, today: TODAY },
    );
    expect(noCrossing.skipped).toBe("no transition into range");

    // no summaries at all → silent skip
    const none = await notifyRiver(
      { riverId: "malir-karachi", summaryStored: true },
      { fetcher, today: TODAY },
    );
    expect(none.skipped).toBe("no summary found");
    expect(bodies).toHaveLength(0);
  });

  it("bootGate refuses missing env; passes migrations when the DB is current (P7-6)", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.X_INTERNAL_TOKEN;
    delete process.env.PREDICT_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    await expect(bootGate()).rejects.toThrow("required env DATABASE_URL is not set");

    // point at the ephemeral DB (fully migrated by beforeAll) — only the
    // optional email env should warn, nothing should throw.
    process.env.DATABASE_URL = url!;
    process.env.X_INTERNAL_TOKEN = "test-token";
    process.env.PREDICT_URL = "http://predict.test";
    process.env.LLM_API_KEY = "test";
    process.env.LLM_MODEL = "test-model";
    const warnings = await bootGate();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.join(" ")).toContain("email nudge disabled");
  });
});
