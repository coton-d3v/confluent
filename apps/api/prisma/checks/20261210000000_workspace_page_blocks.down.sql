-- Reverts migration 20261210000000_workspace_page_blocks (ROADMAP E09.04) before the application is
-- rolled back to E09.03. Lost on the way back: which blocks of each workspace's public page are shown
-- and in which order; the earlier application shows every block in E09.01's order. The workspaces,
-- their other settings and the journal stay (a `workspace_updated` entry may still name the blocks).
-- Nothing references the column: to be run FIRST, before the revert of E09.01
-- (20261207000000_workspace_public_page).
--
-- With every page showing E09.01's blocks in E09.01's order, nothing is lost. Otherwise a block its
-- managers withdrew (the projects' cards, the contact…) would be shown again to the public, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_workspace_page_blocks_loss = 'on';
-- (then, to keep something off a page, its managers clear the text, unpublish the page or hide the
-- cards first). Run in one transaction (psql --single-transaction), then remove the migration's row
-- so it can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261210000000_workspace_page_blocks';
-- Exercised by test/pg/workspace-page-blocks.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_workspace_page_blocks_loss', true), '') <> 'on'
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'workspaces'
         AND column_name = 'public_page_blocks'
     ) THEN
    EXECUTE 'SELECT "slug" FROM "workspaces"
             WHERE "public_page_blocks" IS DISTINCT FROM
                   ARRAY[''presentation'', ''criteria'', ''committees'', ''cards'', ''apply'', ''participate'', ''contact'']::TEXT[]
             ORDER BY "slug" LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'workspace % chose the blocks of its public page: they would be lost; SET LOCAL confluent.accept_workspace_page_blocks_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

ALTER TABLE IF EXISTS "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_page_blocks_check";

ALTER TABLE IF EXISTS "workspaces" DROP COLUMN IF EXISTS "public_page_blocks";
