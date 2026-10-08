#!/usr/bin/env node
// Phase 4 live-band orchestrator (docs/API.md §1.1 contract): one
// kind='forecast' run per river from the newest stored reading. The weekly
// cadence becomes the Phase 7 worker's job — this proves the pipe end-to-end
// and seeds the table.
//
// Usage:
//   node --env-file=.env scripts/predict.mjs --river indus-besham
//   node --env-file=.env scripts/predict.mjs --all

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getObservedSeries, insertPredictionRun } from "./lib/db.mjs";
import { fetchArchiveWeather, toWeatherSeries } from "./lib/weather.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--river") out.river = argv[++i];
    else if (argv[i] === "--all") out.all = true;
    else throw new Error(`unknown arg ${argv[i]}`);
  }
  if (!out.river && !out.all) throw new Error("pass --river <id> or --all");
  return out;
}

function isoDaysAgo(dateStr, days) {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - days * DAY)
    .toISOString()
    .slice(0, 10);
}

async function predictRiver(cfg, dbUrl, predictUrl, token) {
  const { dates, discharge } = await getObservedSeries(dbUrl, cfg.id);
  const history = dates.map((d, i) => ({ date: d, discharge: discharge[i] }));
  const newest = dates[dates.length - 1];

  const weatherStart = isoDaysAgo(newest, 1100);
  // archive ends ~5 days before today; the service tolerates missing tail days
  const archiveEnd = isoDaysAgo(newest, 0);
  const archive = await fetchArchiveWeather(cfg.cell_lat, cfg.cell_lon, weatherStart, archiveEnd);
  const weather_series = toWeatherSeries(archive);

  console.log(`[${cfg.id}] history ${history.length}d (through ${newest}), weather ${weatherStart}..${archiveEnd}`);

  const res = await fetch(`${predictUrl}/v1/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": token },
    body: JSON.stringify({
      river_id: cfg.id,
      history,
      weather_series,
      start_date: newest,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${cfg.id}: predict ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  console.log(
    `[${cfg.id}] ${body.model_version} week band ${body.days[0].band_lo.toFixed(1)}–${body.days[0].band_high.toFixed(1)} (day 1)`,
  );

  const inserted = await insertPredictionRun(
    dbUrl,
    body.days.map((d) => ({
      riverId: cfg.id,
      targetDate: d.date,
      bandLo: d.band_lo,
      bandHigh: d.band_high,
      coverageTarget: 0.75,
      modelVersion: body.model_version,
      kind: "forecast",
    })),
  );
  console.log(`[${cfg.id}] stored ${inserted} prediction rows (kind=forecast)`);
}

const opts = args(process.argv);
const dbUrl = process.env.DATABASE_URL;
const predictUrl = process.env.PREDICT_URL ?? "http://localhost:8000";
const token = process.env.X_INTERNAL_TOKEN;
if (!dbUrl) throw new Error("DATABASE_URL missing (.env)");
if (!token) throw new Error("X_INTERNAL_TOKEN missing (.env)");

const rivers = JSON.parse(readFileSync(resolve(here, "rivers.json"), "utf8"));
const targets = opts.all ? rivers : rivers.filter((r) => r.id === opts.river);
if (targets.length === 0) throw new Error(`no river '${opts.river}' in scripts/rivers.json`);

for (const cfg of targets) {
  await predictRiver(cfg, dbUrl, predictUrl, token);
}
console.log("done.");
