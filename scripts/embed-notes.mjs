#!/usr/bin/env node
// One-off backfill (Phase 7b, P75-3): embed every note that lacks one, with
// the same model the search route queries (all-MiniLM-L6-v2, 384-dim).
// Idempotent — re-running embeds only the NULLs.
// Usage: npx tsx --env-file=.env scripts/embed-notes.mjs

import postgres from "postgres";
import { embedText } from "../src/lib/embed.js";

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 15, max: 1 });

const rows = await sql`
  SELECT id, "text" FROM notes
  WHERE embedding IS NULL
  ORDER BY fetched_at ASC`;

console.log(`notes to embed: ${rows.length}`);
let done = 0;
for (const row of rows) {
  const vec = await embedText(String(row.text));
  await sql`
    UPDATE notes SET embedding = ${`[${vec.join(",")}]`}::vector
    WHERE id = ${row.id} AND embedding IS NULL`;
  done += 1;
  if (done % 10 === 0) console.log(`  ${done}/${rows.length}`);
}
console.log(`embedded ${done} notes.`);

const check = await sql`
  SELECT count(*) FILTER (WHERE embedding IS NOT NULL) AS with_emb,
         count(*) AS total FROM notes`;
console.log(`state: ${check[0].with_emb}/${check[0].total} embedded`);
await sql.end();
