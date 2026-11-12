-- Reverts migration 20261212000000_workspace_page_indexing (ROADMAP E09.06) before the application is
-- rolled back to E09.05. Lost on the way back: which workspaces' managers allowed search engines to
-- index their public page; the earlier application never lets a page be indexed (nothing is opened by
-- the revert), but the managers' choice would be gone when this migration is applied again. The
-- workspaces, their other settings and the journal stay (a `workspace_updated` entry may still name
-- the choice). Nothing references the column: to be run FIRST, before the reverts of E09.05 and
-- earlier.
--
-- Without any page allowed to be indexed, nothing is lost. Otherwise the revert refuses unless the
-- operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_workspace_page_indexing_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261212000000_workspace_page_indexing';
-- Exercised by test/pg/workspace-page-indexing.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_workspace_page_indexing_loss', true), '') <> 'on'
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'workspaces'
         AND column_name = 'public_page_indexable'
     ) THEN
    EXECUTE 'SELECT "slug" FROM "workspaces" WHERE "public_page_indexable" ORDER BY "slug" LIMIT 1'
      INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'workspace % allowed search engines to index its public page: the choice would be lost; SET LOCAL confluent.accept_workspace_page_indexing_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_page_indexable";
