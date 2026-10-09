import postgres from "postgres";
import type { RangeState } from "@/lib/status";
import type { DischargeSeries } from "@/lib/flood";

/**
 * Server-side data access layer (Phase 3). The only module that talks SQL.
 * Parameterized queries only (NFR: no user input touches SQL unescaped).
 *
 * Connection is lazy: importing this module must never open a socket
 * (build-time prerender imports pages that import this file).
 * Tests point DATABASE_TEST_URL at an ephemeral Postgres; production uses
 * DATABASE_URL (Tiger Data).
 */

let client: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!client) {
    const url = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("No database connection string (DATABASE_URL)");
    client = postgres(url, { connect_timeout: 15, max: 5, prepare: false });
  }
  return client;
}

export type RiverRow = {
  id: string;
  name: string;
  stretch: string;
  cellLat: number;
  cellLon: number;
  cellElevation: number;
  runnableLo: number | null;
  runnableHi: number | null;
  rangeState: RangeState;
  honestyNote: string;
};

export type ReadingInput = {
  riverId: string;
  date: string; // YYYY-MM-DD
  kind: "observed" | "forecast";
  discharge: number | null;
  source: string;
  forecastCreatedFor?: string;
};

export type PredictionInput = {
  riverId: string;
  targetDate: string;
  bandLo: number;
  bandHigh: number;
  coverageTarget: number;
  modelVersion: string;
  kind: "forecast" | "backtest";
  /** Required when kind="backtest" (invariant P1): {mae, band_coverage, days, …} */
  metrics?: Record<string, unknown>;
};

export type RetroRun = {
  riverId: string;
  modelVersion: string;
  createdAt: string;
  coverageTarget: number;
  metrics: Record<string, unknown> | null;
  days: {
    date: string;
    bandLo: number;
    bandHigh: number;
    actual: number;
    covered: boolean;
  }[];
};

const SOURCE_URL = "https://flood-api.open-meteo.com";

export async function listRivers(): Promise<RiverRow[]> {
  const rows = await getSql()`
    SELECT id, name, stretch, cell_lat, cell_lon, cell_elevation,
           runnable_lo, runnable_hi, range_state, honesty_note
    FROM rivers
    ORDER BY array_position(
      ARRAY['indus-besham','kunhar-balakot','swat-mingora','malir-karachi'],
      id)`;
  return rows.map(toRiver);
}

export async function getRiver(id: string): Promise<RiverRow | null> {
  const rows = await getSql()`
    SELECT id, name, stretch, cell_lat, cell_lon, cell_elevation,
           runnable_lo, runnable_hi, range_state, honesty_note
    FROM rivers WHERE id = ${id}`;
  return rows.length ? toRiver(rows[0]) : null;
}

/** Newest date with a non-null observed discharge for a river. */
export async function newestObservedDate(riverId: string): Promise<string | null> {
  const rows = await getSql()`
    SELECT max(date)::text AS newest FROM readings
    WHERE river_id = ${riverId} AND kind = 'observed' AND discharge IS NOT NULL`;
  return rows[0]?.newest ?? null;
}

export async function getReadings(
  riverId: string,
  from: string,
  to: string,
  kind: "observed" | "forecast" = "observed",
): Promise<DischargeSeries> {
  const rows = await getSql()`
    SELECT date::text AS date, discharge FROM readings
    WHERE river_id = ${riverId} AND kind = ${kind}
      AND date BETWEEN ${from} AND ${to}
    ORDER BY date ASC`;
  return {
    time: rows.map((r) => r.date),
    discharge: rows.map((r) => (r.discharge === null ? null : Number(r.discharge))),
  };
}

export async function upsertReadings(rows: ReadingInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sql = getSql();
  let inserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      river_id: r.riverId,
      date: r.date,
      kind: r.kind,
      discharge: r.discharge,
      source: r.source,
      forecast_created_for: r.forecastCreatedFor ?? null,
    }));
    await sql`
      INSERT INTO readings
        (river_id, date, kind, discharge, source, forecast_created_for)
      SELECT
        r.river_id,
        r.date::date,
        r.kind,
        r.discharge,
        r.source,
        r.forecast_created_for::date
      FROM jsonb_to_recordset(${sql.json(chunk)})
        AS r(river_id text, date text, kind text,
             discharge double precision, source text, forecast_created_for text)
      ON CONFLICT (river_id, date, kind) DO UPDATE SET
        discharge = EXCLUDED.discharge,
        source = EXCLUDED.source,
        fetched_at = now(),
        forecast_created_for = EXCLUDED.forecast_created_for`;
    inserted += chunk.length;
  }
  return inserted;
}

/**
 * One prediction run in one transaction — every row shares created_at,
 * which is how a run is grouped (DATA_DICTIONARY §5). Invariant P1 is
 * enforced by the caller: backtest rows must carry metrics.
 */
export async function insertPredictions(rows: PredictionInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sql = getSql();
  const chunk = rows.map((r) => ({
    river_id: r.riverId,
    target_date: r.targetDate,
    band_lo: r.bandLo,
    band_high: r.bandHigh,
    coverage_target: r.coverageTarget,
    model_version: r.modelVersion,
    kind: r.kind,
    metrics: r.metrics ? JSON.parse(JSON.stringify(r.metrics)) : null,
  }));
  const result = await sql`
    INSERT INTO predictions
      (river_id, created_at, target_date, band_lo, band_high,
       coverage_target, model_version, kind, metrics)
    SELECT
      r.river_id, now(), r.target_date::date, r.band_lo, r.band_high,
      r.coverage_target, r.model_version, r.kind, r.metrics
    FROM jsonb_to_recordset(${sql.json(chunk)})
      AS r(river_id text, target_date text, band_lo double precision,
           band_high double precision, coverage_target double precision,
           model_version text, kind text, metrics jsonb)`;
  return result.count;
}

/**
 * The newest stored backtest run for a river — /retro and /api/v1/retro
 * read this; they never recompute (DATA_DICTIONARY §5). Truth comes from
 * the readings join (invariant P2); `covered` is derived, not stored.
 */
export async function getLatestBacktest(riverId: string): Promise<RetroRun | null> {
  const rows = await getSql()`
    WITH latest AS (
      SELECT max(created_at) AS at FROM predictions
      WHERE river_id = ${riverId} AND kind = 'backtest'
    )
    SELECT p.created_at::text AS created_at,
           p.target_date::text AS target_date,
           p.band_lo, p.band_high, p.coverage_target,
           p.model_version, p.metrics,
           r.discharge AS actual
    FROM predictions p
    CROSS JOIN latest
    JOIN readings r
      ON r.river_id = p.river_id AND r.date = p.target_date AND r.kind = 'observed'
    WHERE p.river_id = ${riverId} AND p.kind = 'backtest' AND p.created_at = latest.at
    ORDER BY p.target_date ASC`;
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    riverId,
    modelVersion: String(first.model_version),
    createdAt: String(first.created_at),
    coverageTarget: Number(first.coverage_target),
    metrics: (first.metrics ?? null) as Record<string, unknown> | null,
    days: rows.map((row) => {
      const lo = Number(row.band_lo);
      const hi = Number(row.band_high);
      const actual = Number(row.actual);
      return {
        date: String(row.target_date),
        bandLo: lo,
        bandHigh: hi,
        actual,
        covered: actual >= lo && actual <= hi,
      };
    }),
  };
}

// --- Scout ledger + provenance writes (Phase 5, docs/API.md §3.3) ---

export type StoredSearchResult = {
  link: string;
  title: string;
  snippet: string;
  date: string | null;
};

export type SourceInput = {
  url: string;
  kind: "range" | "closure" | "access" | "operator" | "reference";
  /** Verbatim snippet — required for range/closure (invariant S1) */
  quote?: string | null;
  title?: string | null;
  searchQuery?: string | null;
};

export type NoteInput = {
  riverId: string;
  text: string;
  kind: "range" | "closure" | "access" | "operator" | "reference";
  sourceId: string;
};

export type NoteItem = {
  text: string;
  kind: string;
  url: string;
  sourceTitle: string | null;
  fetchedAt: string;
};

/**
 * Cached SerpApi results for (month, query) — null when the query was never
 * spent this month. Cache hits are free and never count toward the cap.
 */
export async function getScoutCache(
  month: string,
  queryHash: string,
): Promise<StoredSearchResult[] | null> {
  const rows = await getSql()`
    SELECT results FROM scout_queries
    WHERE month = ${month} AND query_hash = ${queryHash}`;
  return rows.length
    ? (rows[0].results as StoredSearchResult[])
    : null;
}

/** Records one live search. Returns false when (month, hash) already exists. */
export async function recordScoutQuery(
  month: string,
  queryHash: string,
  query: string,
  results: StoredSearchResult[],
): Promise<boolean> {
  const sql = getSql();
  const result = await sql`
    INSERT INTO scout_queries (month, query_hash, query, results)
    VALUES (${month}, ${queryHash}, ${query}, ${sql.json(results)}::jsonb)
    ON CONFLICT (month, query_hash) DO NOTHING
    RETURNING id`;
  return result.count > 0;
}

/** Live searches already spent in the month (each row = one billable query). */
export async function countScoutQueries(month: string): Promise<number> {
  const rows = await getSql()`
    SELECT count(*)::int AS n FROM scout_queries WHERE month = ${month}`;
  return rows[0].n;
}

/**
 * Stores a provenance row; url is the dedup key (invariant S2). Re-scouting
 * the same page keeps the FIRST fetch (original fetched_at = provenance).
 * Returns {id, inserted}.
 */
export async function upsertSource(
  input: SourceInput,
): Promise<{ id: string; inserted: boolean }> {
  const sql = getSql();
  const inserted = await sql`
    INSERT INTO sources (url, kind, quote, title, search_query)
    VALUES (${input.url}, ${input.kind}, ${input.quote ?? null},
            ${input.title ?? null}, ${input.searchQuery ?? null})
    ON CONFLICT (url) DO NOTHING
    RETURNING id`;
  if (inserted.length > 0) return { id: String(inserted[0].id), inserted: true };
  const existing = await sql`SELECT id FROM sources WHERE url = ${input.url}`;
  return { id: String(existing[0].id), inserted: false };
}

/** Idempotent note write — same river+source+kind+text is a no-op. */
export async function insertNoteIfMissing(input: NoteInput): Promise<boolean> {
  const result = await getSql()`
    INSERT INTO notes (river_id, "text", kind, source_id)
    SELECT ${input.riverId}, ${input.text}, ${input.kind}, ${input.sourceId}
    WHERE NOT EXISTS (
      SELECT 1 FROM notes
      WHERE river_id = ${input.riverId} AND source_id = ${input.sourceId}
        AND kind = ${input.kind} AND "text" = ${input.text}
    )
    RETURNING id`;
  return result.count > 0;
}

/** River-page notes list: claim + its source (no orphan notes by FK). */
export async function getNotes(riverId: string): Promise<NoteItem[]> {
  const rows = await getSql()`
    SELECT n."text" AS text, n.kind AS kind, n.fetched_at::text AS fetched_at,
           s.url AS url, s.title AS source_title
    FROM notes n
    JOIN sources s ON s.id = n.source_id
    WHERE n.river_id = ${riverId}
    ORDER BY n.fetched_at DESC, s.url ASC`;
  return rows.map((r) => ({
    text: String(r.text),
    kind: String(r.kind),
    url: String(r.url),
    sourceTitle: r.source_title === null ? null : String(r.source_title),
    fetchedAt: String(r.fetched_at),
  }));
}

// --- Summary cache + forecast runs (Phase 6, docs/DATA_DICTIONARY §5b) ---

export type SummaryRow = {
  riverId: string;
  cycleDate: string;
  text: string;
  statusWord: string;
  generatedBy: string;
  validated: boolean;
};

export type SummaryInsert = {
  riverId: string;
  cycleDate: string; // YYYY-MM-DD
  text: string;
  statusWord: string;
  generatedBy: string;
  validated: boolean;
};

/**
 * One summaries row per river per cycle_date (invariant: the dashboard cache).
 * Re-running a cycle the same day is a no-op — returns false when the row
 * already exists. Model-failure fallbacks are NOT stored (v1 renders the
 * template client-side, UX_SPEC §4.1 item 4).
 */
export async function insertSummaryIfMissing(input: SummaryInsert): Promise<boolean> {
  const result = await getSql()`
    INSERT INTO summaries (river_id, cycle_date, "text", status_word, generated_by, validated)
    SELECT ${input.riverId}, ${input.cycleDate}::date, ${input.text},
           ${input.statusWord}, ${input.generatedBy}, ${input.validated}
    WHERE NOT EXISTS (
      SELECT 1 FROM summaries
      WHERE river_id = ${input.riverId} AND cycle_date = ${input.cycleDate}::date
    )
    RETURNING id`;
  return result.count > 0;
}

/** Newest summary for a river (any cycle date) — the dashboard sentence. */
export async function getLatestSummary(riverId: string): Promise<SummaryRow | null> {
  const rows = await getSql()`
    SELECT river_id, cycle_date::text AS cycle_date, "text" AS text,
           status_word, generated_by, validated
    FROM summaries WHERE river_id = ${riverId}
    ORDER BY cycle_date DESC, created_at DESC
    LIMIT 1`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    riverId: String(r.river_id),
    cycleDate: String(r.cycle_date),
    text: String(r.text),
    statusWord: String(r.status_word),
    generatedBy: String(r.generated_by),
    validated: Boolean(r.validated),
  };
}

export type ForecastRun = {
  createdAt: string;
  modelVersion: string;
  /** Week envelope: min band_lo / max band_high over the run's 7 days */
  bandLo: number;
  bandHigh: number;
};

/**
 * Newest stored TabPFN forecast run for a river, collapsed to a week
 * envelope. The summarizer prefers this over the GloFAS week band (P6-4):
 * the band the model may reference is the one we predicted and can check.
 */
export async function getLatestForecastRun(riverId: string): Promise<ForecastRun | null> {
  const rows = await getSql()`
    WITH latest AS (
      SELECT max(created_at) AS at FROM predictions
      WHERE river_id = ${riverId} AND kind = 'forecast'
    )
    SELECT min(created_at)::text AS created_at, max(model_version) AS model_version,
           min(band_lo) AS band_lo, max(band_high) AS band_high
    FROM predictions p CROSS JOIN latest
    WHERE p.river_id = ${riverId} AND p.kind = 'forecast' AND p.created_at = latest.at`;
  if (rows.length === 0 || rows[0].created_at === null) return null;
  return {
    createdAt: String(rows[0].created_at),
    modelVersion: String(rows[0].model_version),
    bandLo: Number(rows[0].band_lo),
    bandHigh: Number(rows[0].band_high),
  };
}

function toRiver(row: Record<string, unknown>): RiverRow {
  return {
    id: String(row.id),
    name: String(row.name),
    stretch: String(row.stretch),
    cellLat: Number(row.cell_lat),
    cellLon: Number(row.cell_lon),
    cellElevation: Number(row.cell_elevation),
    runnableLo: row.runnable_lo === null ? null : Number(row.runnable_lo),
    runnableHi: row.runnable_hi === null ? null : Number(row.runnable_hi),
    rangeState: row.range_state as RangeState,
    honestyNote: String(row.honesty_note),
  };
}

export { SOURCE_URL as FLOOD_API_SOURCE };
