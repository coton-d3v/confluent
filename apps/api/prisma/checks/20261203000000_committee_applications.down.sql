-- Reverts migration 20261203000000_committee_applications (ROADMAP E08.03) before the application is
-- rolled back to E08.02. Lost on the way back: every request's entry on a committee (applications,
-- proposals, acceptances, refusals and withdrawals) and the journal entries of their changes; the
-- committees, candidatures and their journals stay; the value added to `audit_action` stays
-- (PostgreSQL cannot remove it; unused). To be run after the revert of E08.04 (which drops nothing
-- it needs, but comes later) and before the reverts of E08.02, E08.01 and of the candidatures'
-- migrations (E06.03 and earlier): the entries reference `committees (id, workspace_id)` and
-- `candidatures (id, workspace_id)`.
--
-- Without any entry nor journal entry, nothing is lost. One would be — a request a structure
-- retained for a committee, an application waiting for an answer, or the trace of who decided —, so
-- the revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_committee_applications_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261203000000_committee_applications';
-- Exercised by test/pg/committee-applications.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_committee_applications_loss', true), '') <> 'on' THEN
    IF to_regclass('committee_applications') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "committee_applications" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'requests are attached to committees (entry %): they would be lost; SET LOCAL confluent.accept_committee_applications_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text = 'committee_application_changed' LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'committee entries are journaled (entry %): they would be lost; SET LOCAL confluent.accept_committee_applications_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type"::text = 'committee_application_changed';

DROP TABLE IF EXISTS "committee_applications";
