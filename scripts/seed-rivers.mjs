#!/usr/bin/env node
// Idempotently syncs scripts/rivers.json (mirror of src/lib/rivers.ts) into the
// rivers table. Invariant R3: exactly one not_a_paddling_river in v1.
// Usage: npm run db:seed [-- --url <connection-string>]

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const argUrl = process.argv.indexOf("--url");
const url = argUrl > -1 ? process.argv[argUrl + 1] : process.env.DATABASE_URL;
if (!url) {
  console.error("seed: no connection string (use --url or DATABASE_URL)");
  process.exit(1);
}

const rivers = JSON.parse(
  await readFile(fileURLToPath(new URL("./rivers.json", import.meta.url)), "utf8"),
);
const paddleRivers = rivers.filter((r) => r.range_state !== "not_a_paddling_river");
if (rivers.length - paddleRivers.length !== 1) {
  console.error("seed: invariant R3 violated — expected exactly 1 honesty-check river");
  process.exit(1);
}

const sql = postgres(url, { connect_timeout: 15 });
for (const r of rivers) {
  await sql`
    INSERT INTO rivers (id, name, stretch, cell_lat, cell_lon, cell_elevation,
                        runnable_lo, runnable_hi, range_state, honesty_note)
    VALUES (${r.id}, ${r.name}, ${r.stretch}, ${r.cell_lat}, ${r.cell_lon},
            ${r.cell_elevation}, ${r.runnable_lo}, ${r.runnable_hi},
            ${r.range_state}, ${r.honesty_note})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      stretch = EXCLUDED.stretch,
      cell_lat = EXCLUDED.cell_lat,
      cell_lon = EXCLUDED.cell_lon,
      cell_elevation = EXCLUDED.cell_elevation,
      range_state = EXCLUDED.range_state,
      honesty_note = EXCLUDED.honesty_note
      -- runnable_* intentionally not overwritten: seed never invents ranges
  `;
  console.log(`seeded: ${r.id}`);
}
await sql.end();
