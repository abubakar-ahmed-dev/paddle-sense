-- 003_range_ordered.sql — verified runnable bounds must be ordered.
-- Live catch 2026-10-12: an owner-entered [120, 55] (lo > hi) passed app
-- config and reached seeding; nothing stops it at the DB layer either.
-- The config-side unit test now rejects it; this CHECK is the DB-side twin.
ALTER TABLE rivers DROP CONSTRAINT IF EXISTS rivers_range_ordered;
ALTER TABLE rivers ADD CONSTRAINT rivers_range_ordered
  CHECK (
    runnable_lo IS NULL
    OR runnable_hi IS NULL
    OR runnable_lo < runnable_hi
  );
