#!/usr/bin/env node
// Backfills observed GloFAS discharge into the readings table.
// Usage: npm run backfill -- [--river all|<river-id>] [--from 2015-01-01] [--to <date>]
// Idempotent: upserts on (river_id, date, kind).

import postgres from "postgres";
import { fetchDischargeRange } from "./lib/flood.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const riverArg = arg("river", "all");
const today = new Date().toISOString().slice(0, 10);
const from = arg("from", "2015-01-01");
const to = arg("to", today);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("backfill: DATABASE_URL missing (--env-file=.env)");
  process.exit(1);
}

const sql = postgres(url, { connect_timeout: 15, max: 3 });
const riverRows = await sql`SELECT id, cell_lat, cell_lon FROM rivers ORDER BY id`;
const rivers =
  riverArg === "all"
    ? riverRows
    : riverRows.filter((r) => r.id === riverArg);
if (rivers.length === 0) {
  console.error(`backfill: no river matching "${riverArg}" (run db:seed first)`);
  process.exit(1);
}

for (const river of rivers) {
  // Single call per river: the API serves 11+ years of daily data in one
  // request once the /v1/flood path is used (see scripts/lib/flood.mjs).
  const rows = [];
  let nulls = 0;
  const series = await fetchDischargeRange(river.cell_lat, river.cell_lon, from, to);
  for (let i = 0; i < series.time.length; i++) {
    const q = series.discharge[i];
    if (q === null) {
      nulls++;
      continue; // store only real values; absence stays absent
    }
    rows.push({
      river_id: river.id,
      date: series.time[i],
      kind: "observed",
      discharge: q,
      source: "https://flood-api.open-meteo.com",
    });
  }
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`
      INSERT INTO readings
        (river_id, date, kind, discharge, source)
      SELECT
        r.river_id,
        r.date::date,
        r.kind,
        r.discharge,
        r.source
      FROM jsonb_to_recordset(${sql.json(chunk)})
        AS r(river_id text, date text, kind text,
             discharge double precision, source text)
      ON CONFLICT (river_id, date, kind) DO UPDATE SET
        discharge = EXCLUDED.discharge,
        source = EXCLUDED.source,
        fetched_at = now()`;
  }
  console.log(
    `${river.id}: ${rows.length} stored, ${nulls} null days skipped (${from} → ${to})`,
  );
}
await sql.end();
console.log("backfill complete.");
