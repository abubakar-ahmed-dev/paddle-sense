import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { RIVERS, type River } from "@/lib/rivers";
import { fetchDischarge, currentDischarge, weekBand } from "@/lib/flood";
import {
  getLatestForecastRun,
  getReadings,
  getRecentSummaries,
  newestObservedDate,
  upsertReadings,
  insertPredictions,
} from "@/lib/db";
import { getDashboardSeries } from "@/lib/series";
import { runScoutCycle } from "@/lib/scout";
import { fallbackSentence, roundLevel, summarizeAll, type RiverSummaryResult } from "@/lib/llm";
import { sendRangeEmail, shouldNotify, type NotifyFetcher } from "@/lib/notify";
import { fetchArchiveWeather, toWeatherSeries } from "../scripts/lib/weather.mjs";
import type { Status } from "@/lib/status";

/**
 * Phase 7 activities (ARCH §3.6): thin, typed wrappers over the existing
 * libraries — no cycle logic lives here. Each activity is independently
 * retried by Temporal (exponential backoff); every write below is already
 * idempotent (upserts, insert-if-missing, ledger cache), and `predictRiver`
 * additionally skips when a run for today exists so a re-executed schedule
 * cannot create a duplicate prediction run (P7-4).
 *
 * Optional trailing `opts` (fetcher injection) exist for tests only; the
 * worker never passes them.
 */

export function riverById(id: string): River {
  const river = RIVERS.find((r) => r.id === id);
  if (!river) throw new Error(`unknown river id: ${id}`);
  return river;
}

export async function fetchAndStoreRiver(
  riverId: string,
): Promise<{ riverId: string; stored: number }> {
  const river = riverById(riverId);
  const series = await fetchDischarge(river.cell.lat, river.cell.lon);
  const today = new Date().toISOString().slice(0, 10);
  // Store only strictly-past days — they are observed values (the tail of
  // the series is GloFAS forecast, whose home is the TabPFN prediction run).
  const rows = series.time
    .map((date, i) => ({ date, q: series.discharge[i] }))
    .filter((d) => d.date < today && d.q !== null)
    .map((d) => ({
      riverId: river.id,
      date: d.date,
      kind: "observed" as const,
      discharge: d.q,
      source: "https://flood-api.open-meteo.com",
    }));
  const stored = await upsertReadings(rows);
  return { riverId: river.id, stored };
}

export type PredictResult = {
  riverId: string;
  predicted: boolean;
  skipped?: string;
  modelVersion?: string;
};

/**
 * One forecast run per river per day: skip when a run created today exists
 * (P7-4). Otherwise reuse the predict-service contract proven in Phase 4
 * (docs/API.md §1.1): observed history + archive weather → 7-day bands.
 */
export async function predictRiver(
  riverId: string,
  opts: {
    fetcher?: typeof fetch;
    /** Pre-fetched archive payload — tests inject this; the worker fetches live */
    archiveWeather?: { time: string[]; rain_mm: (number | null)[]; temp_mean_c: (number | null)[] };
  } = {},
): Promise<PredictResult> {
  const river = riverById(riverId);
  const today = new Date().toISOString().slice(0, 10);

  const run = await getLatestForecastRun(riverId);
  if (run && run.createdAt.slice(0, 10) === today) {
    return { riverId, predicted: false, skipped: "forecast run already exists for today", modelVersion: run.modelVersion };
  }

  const newest = await newestObservedDate(riverId);
  if (!newest) throw new Error(`${riverId}: no observed readings to predict from`);
  const daysAgo = (date: string, n: number) =>
    new Date(new Date(`${date}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const history = await getReadings(riverId, daysAgo(newest, 1100), newest, "observed");
  const pairs = history.time
    .map((date, i) => ({ date, discharge: history.discharge[i] }))
    .filter((d): d is { date: string; discharge: number } => d.discharge !== null);

  // Archive (ERA5) lags ~5 days; the service's feature builder tolerates it.
  const archive =
    opts.archiveWeather ??
    (await fetchArchiveWeather(river.cell.lat, river.cell.lon, daysAgo(newest, 1100), newest));

  const predictUrl = process.env.PREDICT_URL ?? "http://localhost:8000";
  const token = process.env.X_INTERNAL_TOKEN;
  if (!token) throw new Error("X_INTERNAL_TOKEN missing");
  const doFetch = opts.fetcher ?? fetch;
  const res = await doFetch(`${predictUrl}/v1/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": token },
    body: JSON.stringify({
      river_id: riverId,
      history: pairs,
      weather_series: toWeatherSeries(archive),
      start_date: newest,
    }),
  });
  const body = (await res.json()) as {
    model_version?: string;
    days?: { date: string; band_lo: number; band_high: number }[];
    error?: unknown;
  };
  if (!res.ok || !body.days || !body.model_version) {
    throw new Error(`${riverId}: predict ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }

  await insertPredictions(
    body.days.map((d) => ({
      riverId,
      targetDate: d.date,
      bandLo: d.band_lo,
      bandHigh: d.band_high,
      coverageTarget: 0.75,
      modelVersion: body.model_version!,
      kind: "forecast" as const,
    })),
  );
  return { riverId, predicted: true, modelVersion: body.model_version };
}

export async function scoutCycle() {
  return runScoutCycle();
}

export async function summarizeCycle(): Promise<{
  cycleDate: string;
  rivers: RiverSummaryResult[];
}> {
  return summarizeAll();
}

export type NotifyArg = { riverId: string; summaryStored: boolean };
export type NotifyResult = { riverId: string; sent: boolean; skipped?: string; error?: string };

/**
 * Range-entry email (P7-5): only when this cycle actually stored a fresh
 * summary AND the status word moved INTO in_range. Body is the deterministic
 * §6 template — never the LLM sentence alone (ARCH §3.7).
 */
export async function notifyRiver(
  input: NotifyArg,
  opts: { fetcher?: NotifyFetcher; today?: string } = {},
): Promise<NotifyResult> {
  const { riverId, summaryStored } = input;
  if (!summaryStored) {
    return { riverId, sent: false, skipped: "no fresh summary this cycle" };
  }
  const summaries = await getRecentSummaries(riverId, 2);
  const current = summaries[0];
  if (!current) return { riverId, sent: false, skipped: "no summary found" };
  const previous = summaries[1] ?? null;
  if (!shouldNotify(previous?.statusWord ?? null, current.statusWord)) {
    return { riverId, sent: false, skipped: "no transition into range" };
  }

  const river = riverById(riverId);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { series } = await getDashboardSeries(river, today);
  const level = currentDischarge(series);
  const band = weekBand(series);
  const sentence = fallbackSentence(current.statusWord as Status, {
    name: river.name,
    level,
    runnable: river.runnableRange,
  });
  const result = await sendRangeEmail(
    {
      riverId,
      name: river.name,
      level: level === null ? null : roundLevel(level),
      band: band ? { lo: roundLevel(band[0]), high: roundLevel(band[1]) } : null,
      bandSource: "GloFAS week band (Open-Meteo Flood API)",
      sentence,
    },
    opts.fetcher ? { fetcher: opts.fetcher } : {},
  );
  return { riverId, sent: result.sent, skipped: result.skipped };
}

/**
 * Boot gate (DEPLOYMENT.md): the worker refuses to start when the database
 * is missing any migration file that ships with this build, or when required
 * env is absent. Email env is optional — a missing key disables the nudge
 * with a loud line instead of failing every cycle.
 */
export async function bootGate(): Promise<string[]> {
  const warnings: string[] = [];
  for (const name of ["DATABASE_URL", "X_INTERNAL_TOKEN", "PREDICT_URL", "LLM_API_KEY", "LLM_MODEL"]) {
    if (!process.env[name]) throw new Error(`worker boot: required env ${name} is not set`);
  }
  for (const name of ["NOTIFY_EMAIL_KEY", "NOTIFY_EMAIL_TO"]) {
    if (!process.env[name]) warnings.push(`email nudge disabled: ${name} is not set`);
  }

  const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));
  const expected = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const url = process.env.DATABASE_URL;
  const sql = postgres(url!, { connect_timeout: 15, max: 1 });
  try {
    const applied = new Set(
      (await sql`SELECT name FROM _migrations`).map((r) => String(r.name)),
    );
    const missing = expected.filter((f) => !applied.has(f));
    if (missing.length > 0) {
      throw new Error(`worker boot: database is behind — missing migrations: ${missing.join(", ")}`);
    }
  } finally {
    await sql.end();
  }
  return warnings;
}

/** Cycle river order — config-driven, never inline literals (CLAUDE.md). */
export function allRiverIds(): string[] {
  return RIVERS.map((r) => r.id);
}
