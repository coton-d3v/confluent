-- ROADMAP E08.05: the workspace's managers decide the participation requests of E08.04 — accepted or
-- refused, once (rules: @confluent/shared `participation-request.schema.ts`).
--
--  * `participation_requests.status` gains `accepted` and `refused`, both final: a refused person may
--    send the public form again, which makes a new pending request (the partial unique index of
--    E08.04 only holds pending ones).
--  * `decided_at`, `decided_by_id`: when and by whom (the account may disappear: SET NULL).
--  * `admission`: on acceptance only, what it did — `account_created` (account and membership
--    created), `membership_created` (an existing account added to the workspace) or
--    `already_member` (an active membership kept as it was) — and `member_user_id`, that account.
--  * `invitation_email`, `invitation_email_at`: on acceptance only, the email telling the person —
--    `to_send` when decided, then `sent` or `failed` (sent after the decision is committed; a crash
--    in between leaves `to_send`).
--  * `audit_action` gains `participation_request_decided`.
--
-- CHECK: the status list widened in `participation_requests_check` (the rest of it unchanged);
-- `participation_requests_decision_check` ties each status to its decision columns.
--
-- Backfill: none — every existing request is pending, which the new columns (all NULL) describe.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/participation-decisions.pg-spec.ts).
-- Undone by prisma/checks/20261205000000_participation_decisions.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'participation_request_decided';

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMP(3);

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "decided_by_id" TEXT;

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "admission" TEXT;

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "member_user_id" TEXT;

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "invitation_email" TEXT;

ALTER TABLE "participation_requests" ADD COLUMN IF NOT EXISTS "invitation_email_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "participation_requests_decided_by_id_idx" ON "participation_requests"("decided_by_id");

CREATE INDEX IF NOT EXISTS "participation_requests_member_user_id_idx" ON "participation_requests"("member_user_id");

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_decided_by_id_fkey";

ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_member_user_id_fkey";

ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_check";

ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_check" CHECK (
  "status" IN ('pending', 'accepted', 'refused')
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

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_decision_check";

-- The decider and the account admitted may be NULL on a decided request once their account is gone
-- (SET NULL); never set on a request that is not decided, or not accepted.
ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_decision_check" CHECK (
  ("status" = 'pending') = ("decided_at" IS NULL)
  AND ("status" <> 'pending' OR "decided_by_id" IS NULL)
  AND ("status" = 'accepted') = ("admission" IS NOT NULL)
  AND ("admission" IS NULL OR "admission" IN ('account_created', 'membership_created', 'already_member'))
  AND ("status" = 'accepted' OR "member_user_id" IS NULL)
  AND ("status" = 'accepted') = ("invitation_email" IS NOT NULL)
  AND ("invitation_email" IS NULL OR "invitation_email" IN ('to_send', 'sent', 'failed'))
  AND ("invitation_email" IS NULL) = ("invitation_email_at" IS NULL)
);
