-- ROADMAP E08.06: who was told of a committee's change of date, cancellation or restoration
-- (rules: @confluent/shared `committee-follow-up.schema.ts`).
--
--  * `committee_notices`: one person told of one change — at the committee's version that change
--    produced (`committee_version`, never reused: committees are never deleted), at most one per
--    change and person (unique index). `kind`: `rescheduled`, `cancelled` or `restored`. Why the
--    person is told: the request's entry on the committee (`application_id`, E08.03 — its owner)
--    and/or the participant's accepted request (`participation_request_id`, E08.05); at least one.
--    `recipient_id`: the account told — no address nor text copied (the email is read from the
--    account when sent). `state`: `to_send` (recorded with the change), `sending` (claimed by its
--    sender), `sent`, `failed`, or `superseded` (a later change told the same person first), and
--    when it last changed (`state_at`).
--  * Kept inside the committee's workspace (composite key `committees (id, workspace_id)`), removed
--    with the committee, the account, the entry or the request they come from.
--
-- CHECK: closed kind and state lists, version from 1, a reason given.
--
-- Backfill: none — the table starts empty; changes made before it notified nobody.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/committee-notices.pg-spec.ts).
-- Undone by prisma/checks/20261206000000_committee_notices.down.sql.

CREATE TABLE IF NOT EXISTS "committee_notices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "committee_version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "application_id" TEXT,
    "participation_request_id" TEXT,
    "state" TEXT NOT NULL,
    "state_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "committee_notices_committee_id_workspace_id_idx" ON "committee_notices"("committee_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "committee_notices_recipient_id_idx" ON "committee_notices"("recipient_id");

CREATE INDEX IF NOT EXISTS "committee_notices_application_id_idx" ON "committee_notices"("application_id");

CREATE INDEX IF NOT EXISTS "committee_notices_participation_request_id_idx" ON "committee_notices"("participation_request_id");

CREATE UNIQUE INDEX IF NOT EXISTS "committee_notices_committee_id_committee_version_recipient__key" ON "committee_notices"("committee_id", "committee_version", "recipient_id");

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_committee_id_workspace_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_committee_id_workspace_id_fkey" FOREIGN KEY ("committee_id", "workspace_id") REFERENCES "committees"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_recipient_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_application_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "committee_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_participation_request_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_participation_request_id_fkey" FOREIGN KEY ("participation_request_id") REFERENCES "participation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_check";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_check" CHECK (
  "kind" IN ('rescheduled', 'cancelled', 'restored')
  AND "state" IN ('to_send', 'sending', 'sent', 'failed', 'superseded')
  AND "committee_version" >= 1
  AND ("application_id" IS NOT NULL OR "participation_request_id" IS NOT NULL)
);
