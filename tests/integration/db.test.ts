// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import postgres from "postgres";
import {
  upsertReadings,
  getReadings,
  listRivers,
  newestObservedDate,
} from "@/lib/db";

/**
 * Integration tests against a REAL Postgres (ephemeral Docker container,
 * scripts/test-db.mjs). Skipped automatically when DATABASE_TEST_URL is unset,
 * so `npm run test` stays hermetic.
 */
const url = process.env.DATABASE_TEST_URL;

describe.skipIf(!url)("readings persistence (real Postgres)", () => {
  beforeAll(() => {
    // migrate + seed via the production scripts — they are under test too
    execSync(`node scripts/migrate.mjs --url "${url}"`, { stdio: "pipe" });
    execSync(`node scripts/seed-rivers.mjs --url "${url}"`, { stdio: "pipe" });
  });

  it("seeded exactly the 4 curated rivers (invariant R3 via listRivers)", async () => {
    const rivers = await listRivers();
    expect(rivers).toHaveLength(4);
    expect(rivers[0].id).toBe("indus-besham");
    const honesty = rivers.filter((r) => r.rangeState === "not_a_paddling_river");
    expect(honesty).toHaveLength(1);
    expect(honesty[0].id).toBe("malir-karachi");
  });

  it("upsert is idempotent: double insert leaves 3 rows, second write updates value", async () => {
    const base = { riverId: "malir-karachi", kind: "observed" as const, source: "test" };
    const rows = [
      { ...base, date: "2099-01-01", discharge: 1.5 },
      { ...base, date: "2099-01-02", discharge: 2.5 },
      { ...base, date: "2099-01-03", discharge: 3.5 },
    ];
    await upsertReadings(rows);
    await upsertReadings(rows); // duplicate run must be a no-op on row count
    const series = await getReadings("malir-karachi", "2099-01-01", "2099-01-03");
    expect(series.time).toHaveLength(3);
    expect(series.discharge).toEqual([1.5, 2.5, 3.5]);

    await upsertReadings([{ ...base, date: "2099-01-01", discharge: 9.9 }]);
    const updated = await getReadings("malir-karachi", "2099-01-01", "2099-01-01");
    expect(updated.discharge).toEqual([9.9]);
    expect(await newestObservedDate("malir-karachi")).toBe("2099-01-03");
  });

  it("invariant T1: forecast row without forecast_created_for is rejected", async () => {
    await expect(
      upsertReadings([
        {
          riverId: "malir-karachi",
          date: "2099-02-01",
          kind: "forecast",
          discharge: 1,
          source: "test",
          // forecastCreatedFor intentionally missing
        },
      ]),
    ).rejects.toThrow();
  });

  it("negative discharge is rejected (CHECK constraint)", async () => {
    await expect(
      upsertReadings([
        { riverId: "malir-karachi", date: "2099-02-02", kind: "observed", discharge: -1, source: "test" },
      ]),
    ).rejects.toThrow();
  });

  it("forecast rows with forecast_created_for are stored and separable", async () => {
    await upsertReadings([
      {
        riverId: "malir-karachi",
        date: "2099-02-01",
        kind: "forecast",
        discharge: 2,
        source: "test",
        forecastCreatedFor: "2099-01-15",
      },
    ]);
    const forecast = await getReadings("malir-karachi", "2099-02-01", "2099-02-01", "forecast");
    expect(forecast.discharge).toEqual([2]);
    const observed = await getReadings("malir-karachi", "2099-02-01", "2099-02-01", "observed");
    expect(observed.time).toHaveLength(0); // kinds never mix
  });

  it("invariant S1: range source without quote is rejected", async () => {
    const sql = postgres(url!, { prepare: false });
    await expect(
      sql`INSERT INTO sources (url, kind) VALUES ('https://test.example/s1', 'range')`,
    ).rejects.toThrow();
    await sql.end();
  });
});
