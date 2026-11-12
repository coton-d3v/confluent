-- Reverts migration 20261129000000_reading_sessions (ROADMAP E07.08) before the application is rolled
-- back to E07.07. Lost on the way back: the reading sessions — the active time measured for each,
-- and their grouping of reloads and redirections into one view. The earlier application counts the
-- views from the journal again: one per entry, so the readings taken before E07.08 are counted as
-- they were then (every load), and those taken since once per session (one entry each). To be run
-- FIRST, before the reverts of E07.07 and of the earlier migrations.
--
-- Without any measured active time, nothing is lost that the journal does not keep. A measured time
-- would be, so the revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_reading_sessions_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261129000000_reading_sessions';
-- Exercised by test/pg/reading-sessions.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_reading_sessions_loss', true), '') <> 'on'
     AND to_regclass('reading_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT "id" FROM "reading_sessions" WHERE "active_ms" > 0 LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'reading sessions with a measured active time exist (session %): it would be lost; SET LOCAL confluent.accept_reading_sessions_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "reading_sessions";
