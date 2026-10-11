// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import {
  insertPredictions,
  getLatestBacktest,
  upsertReadings,
  type PredictionInput,
} from "@/lib/db";
import { GET as retroRoute } from "@/app/api/v1/retro/route";

/**
 * Phase 4 integration tests against a real Postgres (scripts/test-db.mjs
 * Docker container). Skipped when DATABASE_TEST_URL is unset so `npm run
 * test` stays hermetic. Covers the predictions invariants (P1 at the DB,
 * P2 via the readings join) and the /api/v1/retro contract (API.md §2.4).
 */
const url = process.env.DATABASE_TEST_URL;

function backtestRows(
  riverId: string,
  dates: string[],
  metrics: Record<string, unknown>,
): PredictionInput[] {
  return dates.map((date, i) => ({
    riverId,
    targetDate: date,
    bandLo: 100 + i,
    bandHigh: 200 + i,
    coverageTarget: 0.75,
    modelVersion: "tabpfn-v1-rtest",
    kind: "backtest" as const,
    metrics,
  }));
}

describe.skipIf(!url)("predictions storage + retro readout (real Postgres)", () => {
  beforeAll(() => {
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
  });

  it("invariant P1: kind='backtest' without metrics is rejected by the DB", async () => {
    await expect(
      insertPredictions([
        {
          riverId: "kunhar-balakot",
          targetDate: "2099-03-01",
          bandLo: 1,
          bandHigh: 2,
          coverageTarget: 0.75,
          modelVersion: "test",
          kind: "backtest",
          // metrics intentionally missing
        },
      ]),
    ).rejects.toThrow();
  });

  it("stores a backtest run and the newest run wins", async () => {
    await upsertReadings(
      [0, 1, 2, 3].map((i) => ({
        riverId: "kunhar-balakot",
        date: `2099-04-0${i + 1}`,
        kind: "observed" as const,
        discharge: 10 + i,
        source: "test",
      })),
    );
    await insertPredictions(
      backtestRows("kunhar-balakot", ["2099-04-01", "2099-04-02"], {
        mae: 5,
        band_coverage: 1,
        days: 2,
        trained_through: "2099-03-31",
      }),
    );
    const run1 = await getLatestBacktest("kunhar-balakot");
    expect(run1).not.toBeNull();
    expect(run1!.days).toHaveLength(2);

    // a later run (new created_at) must replace the view, not duplicate it
    await new Promise((r) => setTimeout(r, 20)); // created_at resolution
    await insertPredictions(
      backtestRows("kunhar-balakot", ["2099-04-01", "2099-04-02", "2099-04-03"], {
        mae: 7,
        band_coverage: 0.5,
        days: 3,
      }),
    );
    const run2 = await getLatestBacktest("kunhar-balakot");
    expect(run2!.days).toHaveLength(3);
    expect((run2!.metrics as { mae: number }).mae).toBe(7);
  });

  it("invariant P2: days without a matching readings truth row are not served", async () => {
    await insertPredictions(
      backtestRows("kunhar-balakot", ["2099-04-02", "2099-04-05"], {
        mae: 1,
        band_coverage: 0.5,
        days: 2,
      }),
    );
    // newest run = [04-02, 04-05]; 04-05 has no readings row (only
    // 04-01..04-04 exist) → only 04-02 may be served
    const run = await getLatestBacktest("kunhar-balakot");
    expect(run!.days.map((d) => d.date)).toEqual(["2099-04-02"]);
  });

  it("covered is derived from the truth: edge days count as in-band", async () => {
    await upsertReadings([
      { riverId: "kunhar-balakot", date: "2099-05-01", kind: "observed", discharge: 100, source: "test" },
      { riverId: "kunhar-balakot", date: "2099-05-02", kind: "observed", discharge: 250, source: "test" },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    await insertPredictions([
      {
        riverId: "kunhar-balakot",
        targetDate: "2099-05-01",
        bandLo: 100,
        bandHigh: 200,
        coverageTarget: 0.75,
        modelVersion: "tabpfn-v1-rtest",
        kind: "backtest",
        metrics: { mae: 0, band_coverage: 0.5, days: 2 },
      },
      {
        riverId: "kunhar-balakot",
        targetDate: "2099-05-02",
        bandLo: 100,
        bandHigh: 250,
        coverageTarget: 0.75,
        modelVersion: "tabpfn-v1-rtest",
        kind: "backtest",
        metrics: { mae: 0, band_coverage: 0.5, days: 2 },
      },
    ]);
    const run = await getLatestBacktest("kunhar-balakot");
    const byDate = new Map(run!.days.map((d) => [d.date, d]));
    expect(byDate.get("2099-05-01")!.covered).toBe(true); // actual == band_lo
    expect(byDate.get("2099-05-02")!.covered).toBe(true); // actual == band_high
  });

  it("GET /api/v1/retro returns the stored run per API.md §2.4", async () => {
    const req = new NextRequest("http://localhost/api/v1/retro?river_id=kunhar-balakot");
    const res = await retroRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.river_id).toBe("kunhar-balakot");
    expect(body.model_version).toBe("tabpfn-v1-rtest");
    expect(body.window_days).toBe(body.days.length);
    expect(typeof body.metrics.band_coverage).toBe("number");
    for (const d of body.days) {
      expect(typeof d.band_lo).toBe("number");
      expect(typeof d.band_high).toBe("number");
      expect(typeof d.actual).toBe("number");
      expect(typeof d.covered).toBe("boolean");
    }
  });

  it("GET /api/v1/retro errors follow the §0 error shape", async () => {
    const missing = await retroRoute(new NextRequest("http://localhost/api/v1/retro"));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("river_not_found");

    const unknown = await retroRoute(
      new NextRequest("http://localhost/api/v1/retro?river_id=river-that-never-ran"),
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("river_not_found");
  });
});
