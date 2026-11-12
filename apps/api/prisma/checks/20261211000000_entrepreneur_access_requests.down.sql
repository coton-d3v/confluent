-- Reverts migration 20261211000000_entrepreneur_access_requests (ROADMAP E09.05) before the
-- application is rolled back to E09.04. Lost on the way back: every request for access to a
-- workspace's candidature path sent from the public pages (who asked, their company, their message),
-- the managers' decisions on them (author, date, the invitation email's state) and the journal entries
-- of the submissions and decisions; the values added to `audit_action` stay (PostgreSQL cannot remove
-- them; unused). What an acceptance created stays: the accounts are ordinary entrepreneurs' accounts
-- (E05.04), managed by Confluent's administrators. Nothing else references the table: to be run first,
-- before the reverts of E09.04 and earlier.
--
-- Without any request nor journal entry of one, nothing is lost. One would be — a person waiting for
-- an answer the structure could no longer give, or the trace of who admitted an account —, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_entrepreneur_access_requests_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261211000000_entrepreneur_access_requests';
-- Exercised by test/pg/entrepreneur-access-requests.pg-spec.ts (revert, then apply the migration
-- again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_entrepreneur_access_requests_loss', true), '') <> 'on' THEN
    IF to_regclass('entrepreneur_access_requests') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "entrepreneur_access_requests" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'entrepreneur access requests exist (request %): they would be lost; SET LOCAL confluent.accept_entrepreneur_access_requests_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('entrepreneur_access_request_received', 'entrepreneur_access_request_discarded', 'entrepreneur_access_request_decided') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'entrepreneur access requests are journaled (entry %): they would be lost; SET LOCAL confluent.accept_entrepreneur_access_requests_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('entrepreneur_access_request_received', 'entrepreneur_access_request_discarded', 'entrepreneur_access_request_decided');

DROP TABLE IF EXISTS "entrepreneur_access_requests";
