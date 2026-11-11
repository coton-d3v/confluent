-- Reverts migration 20261122000000_candidature_notes (ROADMAP E06.08) before the application is
-- rolled back to E06.07. Lost on the way back: every internal note (deleted ones included: their
-- trace) and the journal entries of their changes; the value added to `audit_action` stays
-- (PostgreSQL cannot remove it; unused). The journal of interventions reads nothing else of its
-- own. To be run FIRST, before the reverts of E06.06, E06.05, E06.03 and E06.02: the notes' foreign
-- key uses E06.03's unique index on `candidatures (id, workspace_id)`.
--
-- Without any note, nothing is lost. A note would be, so the revert refuses unless the operator
-- accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_candidature_notes_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261122000000_candidature_notes';
-- Exercised by test/pg/candidature-notes.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF to_regclass('candidature_notes') IS NOT NULL
     AND coalesce(current_setting('confluent.accept_candidature_notes_loss', true), '') <> 'on' THEN
    EXECUTE 'SELECT "candidature_id" FROM "candidature_notes" LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'internal notes exist (candidature %): they would be lost; SET LOCAL confluent.accept_candidature_notes_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" = 'candidature_note_updated';

DROP TABLE IF EXISTS "candidature_notes";
