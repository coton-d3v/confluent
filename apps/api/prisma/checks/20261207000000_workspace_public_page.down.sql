-- Reverts migration 20261207000000_workspace_public_page (ROADMAP E09.01) before the application is
-- rolled back to E08.07. Lost on the way back: each workspace's public page — whether it is
-- published, its criteria and its contact; the workspaces, their other settings and the journal
-- stay (a `workspace_updated` entry may still name the fields: it never held their text). Nothing
-- references the columns: it can be run first, before the reverts of earlier migrations.
--
-- With every page unpublished and empty, nothing is lost. Otherwise a page would disappear or text
-- its managers would have to type again, so the revert refuses unless the operator accepts it
-- explicitly for this transaction:
--   SET LOCAL confluent.accept_workspace_public_page_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261207000000_workspace_public_page';
-- Exercised by test/pg/workspace-pages.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_workspace_public_page_loss', true), '') <> 'on'
     AND to_regclass('workspaces') IS NOT NULL
     AND (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'workspaces'
            AND column_name IN ('public_page_published', 'public_criteria', 'public_contact')) = 3 THEN
    EXECUTE 'SELECT "slug" FROM "workspaces"
             WHERE "public_page_published" OR "public_criteria" IS NOT NULL OR "public_contact" IS NOT NULL
             ORDER BY "slug" LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'workspace % has a published page, criteria or a contact: it would be lost; SET LOCAL confluent.accept_workspace_public_page_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

ALTER TABLE IF EXISTS "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_page_version_check";

ALTER TABLE IF EXISTS "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_contact_check";

ALTER TABLE IF EXISTS "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_criteria_check";

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_page_version";

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_contact";

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_criteria";

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_page_published";
