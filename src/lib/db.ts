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
