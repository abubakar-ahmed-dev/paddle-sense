#!/usr/bin/env node
// Prints every stored range candidate (notes.kind='range' joined to its
// source) so the owner can judge credibility. DECISION P5-4: this script
// NEVER promotes anything — range_state flips to 'verified' only via an
// owner-approved change to scripts/rivers.json + src/lib/rivers.ts.
// Usage: npm run range-candidates [-- --river <id>]

import postgres from "postgres";

const argPos = process.argv.indexOf("--river");
const riverFilter = argPos > -1 ? process.argv[argPos + 1] : null;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("range-candidates: no DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
const rows = await sql`
  SELECT n.river_id, n."text" AS claim, n.fetched_at::text AS fetched_at,
         s.url, s.title, s.quote, s.search_query
  FROM notes n
  JOIN sources s ON s.id = n.source_id
  WHERE n.kind = 'range'
    ${riverFilter ? sql`AND n.river_id = ${riverFilter}` : sql``}
  ORDER BY n.river_id ASC, n.fetched_at DESC`;

if (rows.length === 0) {
  console.log("No range candidates stored yet. Run a scout cycle first:");
  console.log("  curl -X POST http://localhost:3000/api/internal/scout -H 'X-Internal-Token: ...'");
  await sql.end();
  process.exit(0);
}

let current = null;
for (const r of rows) {
  if (r.river_id !== current) {
    current = r.river_id;
    console.log(`\n== ${r.river_id} ==`);
  }
  console.log(`\n  claim:   ${r.claim}`);
  console.log(`  quote:   "${r.quote}"`);
  console.log(`  source:  ${r.url}`);
  console.log(`  title:   ${r.title ?? "(none)"}`);
  console.log(`  query:   ${r.search_query ?? "(none)"}`);
  console.log(`  fetched: ${r.fetched_at}`);
}

console.log(`\n${rows.length} candidate(s). To verify one, edit scripts/rivers.json +`);
console.log("src/lib/rivers.ts (rangeState 'verified', runnableRange in m³/s) and re-seed.");
await sql.end();
