-- Reverts migration 20261206000000_committee_notices (ROADMAP E08.06) before the application is rolled
-- back to E08.05. Lost on the way back: the record of who was told of a committee's change of date,
-- cancellation or restoration, and what became of each email (the emails already sent stay sent).
-- Committees, entries, participation requests and accounts stay. To be run FIRST, before the
-- reverts of E08.05, E08.04, E08.03, E08.02 and E08.01: the notices reference `committees`,
-- `committee_applications` and `participation_requests`.
--
-- Without any notice, nothing is lost. One would be — whether a person was told that a committee
-- moved or was cancelled, which a manager could no longer check —, so the revert refuses unless the
-- operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_committee_notices_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261206000000_committee_notices';
-- Exercised by test/pg/committee-notices.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_committee_notices_loss', true), '') <> 'on'
     AND to_regclass('committee_notices') IS NOT NULL THEN
    EXECUTE 'SELECT "id" FROM "committee_notices" LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'committee notices are recorded (notice %): who was told of a change would be lost; SET LOCAL confluent.accept_committee_notices_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "committee_notices";
