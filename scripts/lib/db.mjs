// Node-side DB helpers for the Phase 4 orchestrator scripts (mirrors the
// tagged-template + jsonb_to_recordset patterns of src/lib/db.ts — scripts
// cannot import TS, so this is the .mjs twin; parity is covered by
// integration tests on both sides).

function connect(url) {
  // dynamic import keeps --help paths free of a DB dependency
  return import("postgres").then(({ default: postgres }) => postgres(url, { prepare: false, max: 5 }));
}

/** Full observed series for one river, ascending. */
export async function getObservedSeries(url, riverId) {
  const sql = await connect(url);
  try {
    const rows = await sql`
      SELECT date::text AS date, discharge FROM readings
      WHERE river_id = ${riverId} AND kind = 'observed' AND discharge IS NOT NULL
      ORDER BY date ASC`;
    return { dates: rows.map((r) => r.date), discharge: rows.map((r) => Number(r.discharge)) };
  } finally {
    await sql.end();
  }
}

/**
 * Insert one prediction run in a single transaction (shared created_at
 * groups the run). rows: [{riverId, targetDate, bandLo, bandHigh,
 * coverageTarget, modelVersion, kind, metrics?}] — invariant P1 holds
 * because backtest rows always carry metrics.
 */
export async function insertPredictionRun(url, rows) {
  if (rows.length === 0) return 0;
  const sql = await connect(url);
  try {
    return await sql.begin(async (tx) => {
      const chunk = rows.map((r) => ({
        river_id: r.riverId,
        target_date: r.targetDate,
        band_lo: r.bandLo,
        band_high: r.bandHigh,
        coverage_target: r.coverageTarget,
        model_version: r.modelVersion,
        kind: r.kind,
        metrics: r.metrics ?? null,
      }));
      const result = await tx`
        INSERT INTO predictions
          (river_id, created_at, target_date, band_lo, band_high,
           coverage_target, model_version, kind, metrics)
        SELECT
          r.river_id,
          now(),
          r.target_date::date,
          r.band_lo,
          r.band_high,
          r.coverage_target,
          r.model_version,
          r.kind,
          r.metrics
        FROM jsonb_to_recordset(${tx.json(chunk)})
          AS r(river_id text, target_date text, band_lo double precision,
               band_high double precision, coverage_target double precision,
               model_version text, kind text, metrics jsonb)`;
      return result.count;
    });
  } finally {
    await sql.end();
  }
}
