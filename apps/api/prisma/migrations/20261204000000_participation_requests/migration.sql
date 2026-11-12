-- ROADMAP E08.04: the public participation form of a workspace — someone outside it (an investor,
-- a guest; no account) asks to take part in one or more of its committees. Rules:
-- @confluent/shared `participation-request.schema.ts`.
--
--  * `committees.participation_requests_open`: a manager offers the committee on the workspace's
--    public form (closed by default; offered only while planned and not started, API side).
--  * `participation_requests`: a request — name, organisation, address (lower case), message —,
--    pending until E08.05 decides it. It grants nothing and is linked to no account. At most one
--    pending request per address and workspace (partial unique index, kept by the database even
--    against simultaneous submissions): a new submission adds its sessions to it, counted
--    (`submission_count`, `last_submitted_at`), and keeps what it said first. Its version only grows
--    (the row is never deleted but with its workspace).
--  * `participation_request_committees`: the sessions a request asks for — both composite foreign
--    keys carry `workspace_id` (`participation_requests (id, workspace_id)`, `committees (id,
--    workspace_id)` of E08.01): a request never asks for another workspace's committee. Removed with
--    either.
--  * `audit_action` gains `participation_request_received` and `participation_request_discarded`.
--
-- CHECK: closed status (`pending` only, until E08.05); address in lower case without spaces, one
-- « @ », at most 254 characters; name and organisation on one trimmed bounded line; message in
-- trimmed paragraphs without markup, at most 2000 characters; counts and version from 1.
--
-- Backfill: none — the column starts closed for every committee, the tables start empty.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/participation-requests.pg-spec.ts).
-- Undone by prisma/checks/20261204000000_participation_requests.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'participation_request_received';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'participation_request_discarded';

ALTER TABLE "committees" ADD COLUMN IF NOT EXISTS "participation_requests_open" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "participation_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submission_count" INTEGER NOT NULL DEFAULT 1,
    "last_submitted_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participation_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "participation_request_committees" (
    "request_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participation_request_committees_pkey" PRIMARY KEY ("request_id","committee_id")
);

CREATE INDEX IF NOT EXISTS "participation_requests_workspace_id_created_at_idx" ON "participation_requests"("workspace_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "participation_requests_id_workspace_id_key" ON "participation_requests"("id", "workspace_id");

-- One pending request per address and workspace (not in schema.prisma: Prisma cannot express it).
CREATE UNIQUE INDEX IF NOT EXISTS "participation_requests_pending_email_key" ON "participation_requests"("workspace_id", "email") WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "participation_request_committees_committee_id_workspace_id_idx" ON "participation_request_committees"("committee_id", "workspace_id");

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_workspace_id_fkey";

ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "participation_request_committees" DROP CONSTRAINT IF EXISTS "participation_request_committees_request_id_workspace_id_fkey";

ALTER TABLE "participation_request_committees" ADD CONSTRAINT "participation_request_committees_request_id_workspace_id_fkey" FOREIGN KEY ("request_id", "workspace_id") REFERENCES "participation_requests"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "participation_request_committees" DROP CONSTRAINT IF EXISTS "participation_request_committees_committee_id_workspace_id_fkey";

ALTER TABLE "participation_request_committees" ADD CONSTRAINT "participation_request_committees_committee_id_workspace_id_fkey" FOREIGN KEY ("committee_id", "workspace_id") REFERENCES "committees"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "participation_requests" DROP CONSTRAINT IF EXISTS "participation_requests_check";

ALTER TABLE "participation_requests" ADD CONSTRAINT "participation_requests_check" CHECK (
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
