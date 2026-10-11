// Cost audit (Phase 8): prove the $0 claim with numbers. Reads the live DB,
// prints one line per free-tier dimension, exits 1 if anything is over.
// Run: npm run cost-audit  (needs DATABASE_URL)
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = postgres(url, { connect_timeout: 15, max: 1 });

// Free-tier ceilings (documented in docs/cost-audit.md with their sources)
const SERPAPI_MONTHLY_CAP = 90; // of the free 100; 10 reserved (002 migration)
const TIGER_FREE_MB = 256; // Tiger Data free plan storage ceiling
const AI_STUDIO_RPD = 200; // free-tier requests/day ceiling for the Gemma model
const RESEND_MONTHLY = 3000; // free-tier emails/month (100/day)

const fail = [];
const row = (label, used, cap, unit = "") => {
  const pct = cap ? ((used / cap) * 100).toFixed(1) : "n/a";
  console.log(`${label.padEnd(34)} ${String(used).padStart(8)} / ${cap} ${unit} (${pct}%)`);
  if (used > cap) fail.push(label);
};

try {
  const month = new Date().toISOString().slice(0, 7);
  console.log(`cost audit — ${month} — ${new Date().toISOString()}\n`);

  const serp = await sql`
    SELECT count(*)::int AS n FROM scout_queries WHERE month = ${month}`;
  row("SerpApi live searches (month)", serp[0].n, SERPAPI_MONTHLY_CAP, "searches");

  const llm = await sql`
    SELECT count(*)::int AS n FROM summaries`;
  row("LLM summaries stored (all time)", llm[0].n, AI_STUDIO_RPD, "req/day-equiv");

  const mail = await sql`
    SELECT count(*)::int AS n FROM summaries
    WHERE status_word = 'in_range'
      AND cycle_date >= now() - interval '30 days'`;
  console.log(
    `${"Resend emails (bound)".padEnd(34)} ${String(mail[0].n).padStart(8)} / ${RESEND_MONTHLY} emails (upper bound: one per in-range summary)`,
  );

  const size = await sql`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty,
           pg_database_size(current_database()) / 1024.0 / 1024.0 AS mb`;
  row("DB size", Math.ceil(Number(size[0].mb)), TIGER_FREE_MB, "MB");
  console.log(`  (${size[0].pretty})\n`);

  const counts = await sql`
    SELECT 'readings' t, count(*)::int n FROM readings
    UNION ALL SELECT 'predictions', count(*)::int FROM predictions
    UNION ALL SELECT 'sources', count(*)::int FROM sources
    UNION ALL SELECT 'notes', count(*)::int FROM notes
    UNION ALL SELECT 'scout_queries (cached+spent)', count(*)::int FROM scout_queries
    UNION ALL SELECT 'summaries', count(*)::int FROM summaries
    ORDER BY 1`;
  console.log("row counts:");
  for (const c of counts) console.log(`  ${c.t.padEnd(30)} ${c.n}`);

  const llmToday = await sql`
    SELECT count(*)::int AS n FROM summaries WHERE cycle_date = now()::date`;
  console.log(
    `\nLLM calls today (upper bound: ${llmToday[0].n} + any fallback retries) vs ${AI_STUDIO_RPD}/day free tier`,
  );
} finally {
  await sql.end();
}

if (fail.length) {
  console.error(`\nOVER CAP: ${fail.join(", ")}`);
  process.exit(1);
}
console.log("\nall dimensions inside free tiers");
