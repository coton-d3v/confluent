-- Reverts migration 20261201000000_committees (ROADMAP E08.01) before the application is rolled back
-- to E06.04. Lost on the way back: every committee (cancelled ones included) and the journal entries
-- of their changes; the values added to `audit_action` stay (PostgreSQL cannot remove them; unused).
-- Only E08.03's entries and E08.04's participation requests reference the table: run after the
-- reverts of E08.04 and E08.03 (and of E08.02), before the reverts of earlier migrations.
--
-- Without any committee nor journal entry, nothing is lost. One would be — a session a workspace
-- scheduled, which its managers would have to enter again, or the trace of who changed it —, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_committees_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261201000000_committees';
-- Exercised by test/pg/committees.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_committees_loss', true), '') <> 'on' THEN
    IF to_regclass('committees') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "committees" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'committees exist (committee %): they would be lost; SET LOCAL confluent.accept_committees_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('committee_created', 'committee_updated', 'committee_status_changed') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'committees are journaled (entry %): they would be lost; SET LOCAL confluent.accept_committees_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('committee_created', 'committee_updated', 'committee_status_changed');

DROP TABLE IF EXISTS "committees";
