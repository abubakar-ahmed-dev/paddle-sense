-- 002_scout_ledger.sql — Phase 5 scout budget ledger (docs/API.md §3.3)
-- One row per LIVE SerpApi search, keyed by month + normalized-query hash.
-- Cache hits never insert and never count toward the cap; the budget meter
-- hard-stops at 90 live searches/month (10 of the free 100 stay reserved
-- for in-season manual checks).

CREATE TABLE IF NOT EXISTS scout_queries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month      text NOT NULL,          -- 'YYYY-MM' (UTC)
  query_hash text NOT NULL,          -- sha256 of the normalized query
  query      text NOT NULL,          -- the query as sent to SerpApi
  results    jsonb NOT NULL,         -- organic_results kept verbatim (P5-3 cache)
  spent_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, query_hash)
);
