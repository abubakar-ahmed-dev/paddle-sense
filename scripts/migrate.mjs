#!/usr/bin/env node
// Applies db/migrations/*.sql in filename order, once each, in a transaction.
// Usage: npm run db:migrate [-- --url <connection-string>]
// Connection string resolution: --url flag > DATABASE_URL env (--env-file=.env in npm script).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const argUrl = process.argv.indexOf("--url");
const url = argUrl > -1 ? process.argv[argUrl + 1] : process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: no connection string (use --url or DATABASE_URL)");
  process.exit(1);
}

const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const sql = postgres(url, { connect_timeout: 15 });
await sql.begin(async (tx) => {
  await tx`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set(
    (await tx`SELECT name FROM _migrations`).map((r) => r.name),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = await readFile(join(dir, file), "utf8");
    await tx.unsafe(content);
    await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    console.log(`applied: ${file}`);
  }
});
const count = (await sql`SELECT count(*)::int AS n FROM _migrations`)[0].n;
console.log(`migrations up to date (${count} applied).`);
await sql.end();
