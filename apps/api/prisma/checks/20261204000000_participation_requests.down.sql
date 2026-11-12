-- Reverts migration 20261204000000_participation_requests (ROADMAP E08.04) before the application is
-- rolled back to E08.03. Lost on the way back: every participation request sent from the public
-- forms (who asked, their message, the sessions chosen), the journal entries of the submissions,
-- and which committees their managers offered on the form (`committees.participation_requests_open`);
-- the committees themselves and their journal stay; the values added to `audit_action` stay
-- (PostgreSQL cannot remove them; unused). To be run FIRST, before the reverts of E08.03, E08.02 and
-- E08.01: the requests reference `committees (id, workspace_id)`.
--
-- Without any request, journal entry nor committee offered, nothing is lost. One would be — a person
-- waiting for an answer the structure could no longer give, or a manager's choice to open a
-- session —, so the revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_participation_requests_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261204000000_participation_requests';
-- Exercised by test/pg/participation-requests.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_participation_requests_loss', true), '') <> 'on' THEN
    IF to_regclass('participation_requests') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "participation_requests" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'participation requests exist (request %): they would be lost; SET LOCAL confluent.accept_participation_requests_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('participation_request_received', 'participation_request_discarded') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'participation requests are journaled (entry %): they would be lost; SET LOCAL confluent.accept_participation_requests_loss = ''on'' to revert all the same', found;
    END IF;
    IF to_regclass('committees') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'committees'
                     AND column_name = 'participation_requests_open') THEN
      EXECUTE 'SELECT "id" FROM "committees" WHERE "participation_requests_open" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'committees are offered on the public form (committee %): the choice would be lost; SET LOCAL confluent.accept_participation_requests_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('participation_request_received', 'participation_request_discarded');

DROP TABLE IF EXISTS "participation_request_committees";

DROP TABLE IF EXISTS "participation_requests";

ALTER TABLE IF EXISTS "committees" DROP COLUMN IF EXISTS "participation_requests_open";
