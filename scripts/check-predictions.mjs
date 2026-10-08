// One-off inspection: stored prediction runs (Phase 4). Not wired into npm.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const rows = await sql`
  SELECT river_id, kind, count(*)::int AS n,
         min(created_at)::text AS run_start,
         max(metrics->>'band_coverage') AS coverage,
         max(metrics->>'mae') AS mae,
         max(metrics->>'trained_through') AS trained_through
  FROM predictions
  GROUP BY river_id, kind, created_at
  ORDER BY run_start, river_id`;
for (const r of rows) {
  console.log(
    `${r.run_start.slice(0, 19)}  ${r.river_id.padEnd(16)} ${r.kind.padEnd(8)} n=${r.n}  coverage=${r.coverage ?? "—"}  mae=${r.mae ?? "—"}  trained_through=${r.trained_through ?? "—"}`,
  );
}
await sql.end();
