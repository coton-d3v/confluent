-- ROADMAP E09.01: a workspace's public page (`/w/<slug>`). Rules and limits: @confluent/shared
-- `workspace-page.schema.ts`; what the public reads of each column of `workspaces`:
-- `WORKSPACE_COLUMN_AUDIENCE` (src/modules/workspace-pages/workspace-page-views.ts).
--
--  * `workspaces.public_page_published`: closed by default — no page until a manager turns it on.
--  * `workspaces.public_criteria`, `workspaces.public_contact`: plain text in paragraphs, or none,
--    shown to anyone once the page is published (beside the name, programme, colour, presentation and
--    logo the workspace already has; its contact email for members and its email domain never are).
--  * `workspaces.public_page_version`: the version of these settings a manager writes from (`409`
--    otherwise), incremented by each change, never reused.
--  * No new journal action: a change is journaled by `workspace_updated`, which names the fields and
--    never copies the texts.
--
-- CHECK: criteria (1 to 3000 characters) and contact (1 to 1000) trimmed paragraphs without control
-- characters, more than one blank line or markup; version ≥ 1.
--
-- Backfill: none — every existing workspace starts unpublished, without criteria or contact, at
-- version 1 (the column defaults).
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF NOT EXISTS, constraint dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/workspace-pages.pg-spec.ts).
-- Undone by prisma/checks/20261207000000_workspace_public_page.down.sql.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_page_published" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_criteria" TEXT;

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_contact" TEXT;

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_page_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_criteria_check";

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_criteria_check" CHECK (
  "public_criteria" IS NULL OR (
    char_length("public_criteria") BETWEEN 1 AND 3000
    AND "public_criteria" = btrim("public_criteria", E' \n')
    AND translate("public_criteria", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("public_criteria", E'\n\n\n') = 0
    AND "public_criteria" !~ '<[A-Za-z!/?]'
  )
);

ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_contact_check";

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_contact_check" CHECK (
  "public_contact" IS NULL OR (
    char_length("public_contact") BETWEEN 1 AND 1000
    AND "public_contact" = btrim("public_contact", E' \n')
    AND translate("public_contact", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("public_contact", E'\n\n\n') = 0
    AND "public_contact" !~ '<[A-Za-z!/?]'
  )
);

ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_page_version_check";

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_page_version_check" CHECK (
  "public_page_version" >= 1
);
