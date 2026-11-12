-- ROADMAP E09.05: an entrepreneur without an account asks a workspace, from its public page, for
-- access to its candidature path; the workspace's managers accept or refuse the request, once. Rules:
-- @confluent/shared `entrepreneur-access-request.schema.ts`.
--
--  * `entrepreneur_access_requests`: a request — name, company (or project) name, address (lower
--    case), message —, pending until a manager decides it. It grants nothing and is linked to no
--    account. At most one pending request per address and workspace (partial unique index, kept by
--    the database even against simultaneous submissions): a new submission is counted on it
--    (`submission_count`, `last_submitted_at`) and keeps what it said first. Its version only grows
--    (the row is never deleted but with its workspace). Decided: `accepted` or `refused`, final —
--    when and by whom (`decided_at`, `decided_by_id`, SET NULL once that account is gone); accepted
--    only, what it did to the address's account (`admission`: `account_created` or
--    `account_existing`, `account_user_id`) and the invitation email's state (`invitation_email`:
--    `to_send` when decided, then `sent` or `failed`; a crash in between leaves `to_send`).
--  * `audit_action` gains `entrepreneur_access_request_received`, `…_discarded` and `…_decided`.
--
-- CHECK: closed status, admission and email state; each status tied to its decision columns; address
-- in lower case without spaces, one « @ », at most 254 characters; name (≤ 120) and company name
-- (≤ 200) on one trimmed line; message in trimmed paragraphs without markup, at most 2000
-- characters; counts and version from 1.
--
-- Backfill: none — the table starts empty.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database
-- (test/pg/entrepreneur-access-requests.pg-spec.ts).
-- Undone by prisma/checks/20261211000000_entrepreneur_access_requests.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'entrepreneur_access_request_received';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'entrepreneur_access_request_discarded';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'entrepreneur_access_request_decided';

CREATE TABLE IF NOT EXISTS "entrepreneur_access_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submission_count" INTEGER NOT NULL DEFAULT 1,
    "last_submitted_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "admission" TEXT,
    "account_user_id" TEXT,
    "invitation_email" TEXT,
    "invitation_email_at" TIMESTAMP(3),

    CONSTRAINT "entrepreneur_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entrepreneur_access_requests_workspace_id_created_at_idx" ON "entrepreneur_access_requests"("workspace_id", "created_at");

CREATE INDEX IF NOT EXISTS "entrepreneur_access_requests_decided_by_id_idx" ON "entrepreneur_access_requests"("decided_by_id");

CREATE INDEX IF NOT EXISTS "entrepreneur_access_requests_account_user_id_idx" ON "entrepreneur_access_requests"("account_user_id");

-- One pending request per address and workspace (not in schema.prisma: Prisma cannot express it).
CREATE UNIQUE INDEX IF NOT EXISTS "entrepreneur_access_requests_pending_email_key" ON "entrepreneur_access_requests"("workspace_id", "email") WHERE "status" = 'pending';

ALTER TABLE "entrepreneur_access_requests" DROP CONSTRAINT IF EXISTS "entrepreneur_access_requests_workspace_id_fkey";

ALTER TABLE "entrepreneur_access_requests" ADD CONSTRAINT "entrepreneur_access_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entrepreneur_access_requests" DROP CONSTRAINT IF EXISTS "entrepreneur_access_requests_decided_by_id_fkey";

ALTER TABLE "entrepreneur_access_requests" ADD CONSTRAINT "entrepreneur_access_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "entrepreneur_access_requests" DROP CONSTRAINT IF EXISTS "entrepreneur_access_requests_account_user_id_fkey";

ALTER TABLE "entrepreneur_access_requests" ADD CONSTRAINT "entrepreneur_access_requests_account_user_id_fkey" FOREIGN KEY ("account_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "entrepreneur_access_requests" DROP CONSTRAINT IF EXISTS "entrepreneur_access_requests_check";

ALTER TABLE "entrepreneur_access_requests" ADD CONSTRAINT "entrepreneur_access_requests_check" CHECK (
  "status" IN ('pending', 'accepted', 'refused')
  AND char_length("email") BETWEEN 3 AND 254
  AND "email" = lower("email")
  AND "email" ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
  AND char_length("name") BETWEEN 1 AND 120
  AND "name" = btrim("name")
  AND "name" !~ '[[:cntrl:]]'
  AND strpos("name", '  ') = 0
  AND char_length("company_name") BETWEEN 1 AND 200
  AND "company_name" = btrim("company_name")
  AND "company_name" !~ '[[:cntrl:]]'
  AND strpos("company_name", '  ') = 0
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

ALTER TABLE "entrepreneur_access_requests" DROP CONSTRAINT IF EXISTS "entrepreneur_access_requests_decision_check";

-- The decider and the account may be NULL on a decided request once their account is gone (SET
-- NULL); never set on a request that is not decided, or not accepted.
ALTER TABLE "entrepreneur_access_requests" ADD CONSTRAINT "entrepreneur_access_requests_decision_check" CHECK (
  ("status" = 'pending') = ("decided_at" IS NULL)
  AND ("status" <> 'pending' OR "decided_by_id" IS NULL)
  AND ("status" = 'accepted') = ("admission" IS NOT NULL)
  AND ("admission" IS NULL OR "admission" IN ('account_created', 'account_existing'))
  AND ("status" = 'accepted' OR "account_user_id" IS NULL)
  AND ("status" = 'accepted') = ("invitation_email" IS NOT NULL)
  AND ("invitation_email" IS NULL OR "invitation_email" IN ('to_send', 'sent', 'failed'))
  AND ("invitation_email" IS NULL) = ("invitation_email_at" IS NULL)
);
