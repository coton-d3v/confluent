-- ROADMAP E05.10: an AI application connected through OAuth reaches a workspace only if the person
-- allowed it on the consent screen, among their active memberships. The choice is stored with the
-- authorization (`oauth_grants`), whose tokens — refreshed ones included — never widen it; the
-- membership itself is checked again at every MCP tool call.
--
-- Backfill: every existing authorization was given before this choice existed, so it reaches no
-- workspace (closed by default): the column's default fills the existing rows with an empty list,
-- and the UPDATE below says so explicitly for a database resumed after a partial run. The person
-- reconnects the application to choose workspaces; their own dossiers stay reachable as before.
--
-- Deployment resume: each statement can run again (IF NOT EXISTS, constraint dropped before being
-- added), so any prefix of this file, then the whole file, gives the same database. Undone by
-- prisma/checks/20261116000000_oauth_grant_workspaces.down.sql.

ALTER TABLE "oauth_grants" ADD COLUMN IF NOT EXISTS "workspace_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "oauth_grants" SET "workspace_ids" = ARRAY[]::TEXT[] WHERE "workspace_ids" IS NULL;

-- A workspace identifier, never a missing one.
ALTER TABLE "oauth_grants" DROP CONSTRAINT IF EXISTS "oauth_grants_workspace_ids_check";
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_workspace_ids_check"
  CHECK (array_position("workspace_ids", NULL) IS NULL);
