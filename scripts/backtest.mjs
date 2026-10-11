#!/usr/bin/env node
// Phase 4 backtest orchestrator (docs/API.md §1.2 is the service contract).
//
// Per river: hide the last N days (default 28) of stored observed readings,
// send everything before as history + the hidden days as truth, score, and
// store the run in `predictions` (kind='backtest', metrics jsonb per row —
// invariant P1). The /retro page reads stored rows only; it never recomputes.
//
// Usage:
//   node --env-file=.env scripts/backtest.mjs --river indus-besham
//   node --env-file=.env scripts/backtest.mjs --all [--days 28]

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getObservedSeries, insertPredictionRun } from "./lib/db.mjs";
import { fetchArchiveWeather, toWeatherSeries } from "./lib/weather.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

function args(argv) {
  const out = { days: 28 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--river") out.river = argv[++i];
    else if (argv[i] === "--all") out.all = true;
    else if (argv[i] === "--days") out.days = Number(argv[++i]);
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

async function backtestRiver(cfg, dbUrl, predictUrl, token, hiddenDays) {
  const { dates, discharge } = await getObservedSeries(dbUrl, cfg.id);
  if (dates.length < hiddenDays + 120) {
    throw new Error(`${cfg.id}: not enough stored history (${dates.length} days)`);
  }
  const split = dates.length - hiddenDays;
  const hiddenFrom = dates[split];
  const hiddenTo = dates[dates.length - 1];
  // The service needs the hidden window to be exactly daily — null readings
  // are filtered by the query, so a calendar-span mismatch means holes.
  const spanDays = Math.round((new Date(`${hiddenTo}T00:00:00Z`) - new Date(`${hiddenFrom}T00:00:00Z`)) / DAY) + 1;
  if (spanDays !== hiddenDays) {
    throw new Error(
      `${cfg.id}: hidden window has holes (wanted ${hiddenDays} days, ${dates[split]}..${hiddenTo} spans ${spanDays}) — reduce --days or refresh readings`,
    );
  }
  const history = dates.slice(0, split).map((d, i) => ({ date: d, discharge: discharge[i] }));
  const truth = dates.slice(split).map((d, i) => ({
    date: d,
    discharge: discharge[split + i],
  }));

  // Weather across the model's training context (1,060 rows ≈ 3 years) plus
  // the hidden window; archive API is immutable history → cached on disk.
  const weatherStart = isoDaysAgo(hiddenFrom, 1100);
  const archive = await fetchArchiveWeather(cfg.cell_lat, cfg.cell_lon, weatherStart, hiddenTo);
  const weather_series = toWeatherSeries(archive);

  console.log(
    `[${cfg.id}] history ${history.length}d (through ${dates[split - 1]}), hidden ${hiddenFrom}..${hiddenTo} (${hiddenDays}d), weather ${weatherStart}..${hiddenTo}`,
  );

  const t0 = Date.now();
  const res = await fetch(`${predictUrl}/v1/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": token },
    body: JSON.stringify({
      river_id: cfg.id,
      history,
      hidden_window: { from: hiddenFrom, to: hiddenTo },
      truth,
      weather_series,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${cfg.id}: backtest ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[${cfg.id}] ${body.model_version} mae=${body.metrics.mae.toFixed(1)} coverage=${(body.metrics.band_coverage * 100).toFixed(1)}% (${secs}s)`,
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
      kind: "backtest",
      metrics: {
        mae: body.metrics.mae,
        band_coverage: body.metrics.band_coverage,
        days: body.metrics.days,
        // per-horizon decay keys (day{n}_coverage / day{n}_mae, P75-6) pass
        // through verbatim from the service response
        ...Object.fromEntries(
          Object.entries(body.metrics).filter(([k]) => /^day\d+_(coverage|mae)$/.test(k)),
        ),
        trained_through: body.trained_through,
        hidden_window: { from: hiddenFrom, to: hiddenTo },
      },
    })),
  );
  console.log(`[${cfg.id}] stored ${inserted} prediction rows (kind=backtest)`);
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
  await backtestRiver(cfg, dbUrl, predictUrl, token, opts.days);
}
console.log("done.");
