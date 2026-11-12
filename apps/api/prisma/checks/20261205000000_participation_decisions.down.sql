-- Reverts migration 20261205000000_participation_decisions (ROADMAP E08.05) before the application is
-- rolled back to E08.04. Lost on the way back: every decided participation request (accepted or
-- refused — who asked, the sessions, the decision, its author and date, the invitation email's state)
-- and the journal entries of the decisions; pending requests stay as E08.04 knows them; the value
-- added to `audit_action` stays (PostgreSQL cannot remove it; unused). What an acceptance created
-- stays too: the accounts and workspace memberships are ordinary ones (E05.02), managed from the
-- workspace's members. To be run FIRST, before the reverts of E08.04, E08.03, E08.02 and E08.01.
--
-- Without any decision nor journal entry of one, nothing is lost. One would be — the trace of who
-- admitted a person to the workspace, or a refusal the structure would have to make again —, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_participation_decisions_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261205000000_participation_decisions';
-- Exercised by test/pg/participation-decisions.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_participation_decisions_loss', true), '') <> 'on' THEN
    IF to_regclass('participation_requests') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "participation_requests" WHERE "status" <> ''pending'' LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'participation requests are decided (request %): the decisions would be lost; SET LOCAL confluent.accept_participation_decisions_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text = 'participation_request_decided' LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'participation decisions are journaled (entry %): they would be lost; SET LOCAL confluent.accept_participation_decisions_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type"::text = 'participation_request_decided';

DO $$
BEGIN
  IF to_regclass('participation_requests') IS NOT NULL THEN
    -- Their sessions go with them (ON DELETE CASCADE).
    EXECUTE 'DELETE FROM "participation_requests" WHERE "status" <> ''pending''';
  END IF;
END $$;

ALTER TABLE IF EXISTS "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_decision_check";

ALTER TABLE IF EXISTS "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_check";

-- As migration 20261204000000_participation_requests wrote it.
ALTER TABLE IF EXISTS "participation_requests" ADD CONSTRAINT "participation_requests_check" CHECK (
  "status" IN ('pending')
  AND char_length("email") BETWEEN 3 AND 254
  AND "email" = lower("email")
  AND "email" ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
  AND char_length("name") BETWEEN 1 AND 120
  AND "name" = btrim("name")
  AND "name" !~ '[[:cntrl:]]'
  AND strpos("name", '  ') = 0
  AND ("organization" IS NULL OR (
    char_length("organization") BETWEEN 1 AND 120
    AND "organization" = btrim("organization")
    AND "organization" !~ '[[:cntrl:]]'
    AND strpos("organization", '  ') = 0
  ))
  AND ("message" IS NULL OR (
    char_length("message") BETWEEN 1 AND 2000
    AND "message" = btrim("message", E' \n')
    AND translate("message", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("message", E'\n\n\n') = 0
    AND "message" !~ '<[A-Za-z!/?]'
  ))
  AND "submission_count" >= 1
  AND "version" >= 1
);

ALTER TABLE IF EXISTS "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_decided_by_id_fkey";

ALTER TABLE IF EXISTS "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_member_user_id_fkey";

DROP INDEX IF EXISTS "participation_requests_decided_by_id_idx";

DROP INDEX IF EXISTS "participation_requests_member_user_id_idx";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "decided_at";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "decided_by_id";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "admission";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "member_user_id";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "invitation_email";

ALTER TABLE IF EXISTS "participation_requests" DROP COLUMN IF EXISTS "invitation_email_at";
