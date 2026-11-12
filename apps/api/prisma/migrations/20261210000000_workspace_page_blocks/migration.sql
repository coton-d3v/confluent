-- ROADMAP E09.04: the blocks of a workspace's public page, chosen and ordered by its managers. Rules:
-- @confluent/shared `workspace-page.schema.ts` (`PUBLIC_PAGE_BLOCKS`, `toPublicWorkspacePage`); what
-- the public reads of each column of `workspaces`: `WORKSPACE_COLUMN_AUDIENCE`
-- (src/modules/workspace-pages/workspace-page-views.ts).
--
--  * `workspaces.public_page_blocks`: the blocks shown below the page's header, in their order, from
--    a closed catalogue (presentation, criteria, committees, cards, apply, participate, contact),
--    each at most once; a block not named is not shown. A block never adds data to the page: it shows
--    or not what E09.01–E09.03 already allow. Versioned with the other settings of the page
--    (`public_page_version`), journaled by `workspace_updated` (no new journal action).
--
-- CHECK: never null, known blocks only (no null element), each at most once, one dimension.
--
-- Backfill: the column default — every existing page keeps E09.01's page, every block in its order.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF NOT EXISTS, constraint dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/workspace-page-blocks.pg-spec.ts).
-- Undone by prisma/checks/20261210000000_workspace_page_blocks.down.sql.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_page_blocks" TEXT[] DEFAULT ARRAY['presentation', 'criteria', 'committees', 'cards', 'apply', 'participate', 'contact']::TEXT[];

ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_public_page_blocks_check";

-- Not null by this constraint rather than the column's, as Prisma describes a list column.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_page_blocks_check" CHECK (
  "public_page_blocks" IS NOT NULL
  AND coalesce(array_ndims("public_page_blocks"), 1) = 1
  AND "public_page_blocks" <@ ARRAY['presentation', 'criteria', 'committees', 'cards', 'apply', 'participate', 'contact']::TEXT[]
  AND cardinality(array_positions("public_page_blocks", 'presentation')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'criteria')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'committees')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'cards')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'apply')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'participate')) <= 1
  AND cardinality(array_positions("public_page_blocks", 'contact')) <= 1
);
