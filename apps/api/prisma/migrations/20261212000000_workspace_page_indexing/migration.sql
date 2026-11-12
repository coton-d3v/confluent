-- ROADMAP E09.06: search engines index a workspace's public page only once its managers allow it.
-- Rules: @confluent/shared `workspace-page.schema.ts` (`publicPageRobots`); what the public reads of
-- each column of `workspaces`: `WORKSPACE_COLUMN_AUDIENCE`
-- (src/modules/workspace-pages/workspace-page-views.ts).
--
--  * `workspaces.public_page_indexable`: the managers allow search engines to index the page while it
--    is published (`index, follow`); every other page of the site says `noindex, nofollow`. Versioned
--    with the other settings of the page (`public_page_version`), journaled by `workspace_updated`
--    (no new journal action).
--
-- Backfill: the column default — no page is indexable until its managers say so.
--
-- Deployment resume: Prisma runs this file as one transaction; the statement can also run again on a
-- partly migrated database (IF NOT EXISTS), so any prefix of this file, then the whole file, gives the
-- same database (test/pg/workspace-page-indexing.pg-spec.ts).
-- Undone by prisma/checks/20261212000000_workspace_page_indexing.down.sql.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "public_page_indexable" BOOLEAN NOT NULL DEFAULT false;
