-- 001_init.sql — Phase 3 initial schema
-- Authoritative field/invariant reference: docs/DATA_DICTIONARY.md §2–7.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rivers (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  stretch         text NOT NULL,
  cell_lat        double precision NOT NULL,
  cell_lon        double precision NOT NULL,
  cell_elevation  integer NOT NULL,
  runnable_lo     double precision,
  runnable_hi     double precision,
  range_state     text NOT NULL
    CHECK (range_state IN ('verified', 'unverified', 'not_a_paddling_river')),
  range_source_id uuid,
  honesty_note    text NOT NULL,
  -- invariant R1: verified ⇔ bounds + source present
  CONSTRAINT rivers_verified_complete CHECK (
    (range_state = 'verified') =
    (runnable_lo IS NOT NULL AND runnable_hi IS NOT NULL AND range_source_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url          text NOT NULL UNIQUE,
  kind         text NOT NULL
    CHECK (kind IN ('range', 'closure', 'access', 'operator', 'reference')),
  quote        text,
  title        text,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  search_query text,
  -- invariant S1: quote-or-reject for ranges and closures
  CONSTRAINT sources_quote_required
    CHECK (kind NOT IN ('range', 'closure') OR quote IS NOT NULL)
);

ALTER TABLE rivers
  ADD CONSTRAINT rivers_range_source_fk
  FOREIGN KEY (range_source_id) REFERENCES sources (id);

CREATE TABLE IF NOT EXISTS readings (
  river_id             text NOT NULL REFERENCES rivers (id),
  date                 date NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('observed', 'forecast')),
  discharge            double precision CHECK (discharge IS NULL OR discharge >= 0),
  source               text NOT NULL,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  forecast_created_for date,
  PRIMARY KEY (river_id, date, kind),
  -- invariant T1: forecast rows always record the cycle that produced them
  CONSTRAINT readings_forecast_meta
    CHECK (kind <> 'forecast' OR forecast_created_for IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS readings_river_kind_date_idx
  ON readings (river_id, kind, date DESC);

CREATE TABLE IF NOT EXISTS predictions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  river_id        text NOT NULL REFERENCES rivers (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  target_date     date NOT NULL,
  band_lo         double precision NOT NULL,
  band_high       double precision NOT NULL,
  coverage_target double precision NOT NULL,
  model_version   text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('forecast', 'backtest')),
  metrics         jsonb,
  -- invariant P1: backtest rows carry their metrics
  CONSTRAINT predictions_backtest_metrics
    CHECK (kind <> 'backtest' OR metrics IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS summaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  river_id     text NOT NULL REFERENCES rivers (id),
  cycle_date   date NOT NULL,
  text         text NOT NULL,
  status_word  text NOT NULL,
  generated_by text NOT NULL,
  validated    boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  river_id   text NOT NULL REFERENCES rivers (id),
  "text"     text NOT NULL,
  kind       text NOT NULL
    CHECK (kind IN ('range', 'closure', 'access', 'operator', 'reference')),
  source_id  uuid NOT NULL REFERENCES sources (id),
  embedding  vector(384),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_embedding_hnsw
  ON notes USING hnsw (embedding vector_cosine_ops);
