-- Reverts migration 20261116000000_oauth_grant_workspaces (ROADMAP E05.10) before the application is
-- rolled back to E05.09. Lost on the way back: the workspaces each connected application was allowed
-- to reach. Authorizations carrying the permission `dossiers:present` keep it in `scopes`: E05.09
-- neither offers nor honours it (no tool requires it).
--
-- Going back WIDENS what some connections reach (code review R58): under E05.09, `list_dossiers` and
-- `get_dossier` give a connection every company its account holds, the companies it prepares as a
-- conseiller (E05.08) included, whatever workspace the person allowed. So the revert refuses while a
-- connection in force (neither revoked nor expired) belongs to an account that owns a company
-- prepared in a workspace absent from `workspace_ids`, or is a conseiller — active or not — of such
-- a workspace (it could prepare one there once back on E05.09). The operator either revokes those
-- connections first, or has this script revoke them, with their tokens, journaled
-- (`oauth_grant_revoked`, reason `migration_revert`), for this transaction:
--   SET LOCAL confluent.revoke_wider_grants = 'on';
-- There is deliberately no setting to accept the widening: the person refused it on the consent
-- screen; revoked, the application asks them again (E05.09's consent) at its next connection.
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116000000_oauth_grant_workspaces';
-- Exercised by test/pg/oauth-grant-workspaces.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  widened TEXT;
BEGIN
  -- Already undone (a run resumed after the column went): nothing left to check.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'oauth_grants' AND column_name = 'workspace_ids'
  ) THEN
    RETURN;
  END IF;
  CREATE TEMP TABLE "widened_grants" AS
    SELECT g."id", g."user_id" FROM "oauth_grants" g
    WHERE g."revoked_at" IS NULL
      AND g."expires_at" > (now() AT TIME ZONE 'UTC')
      AND (
        EXISTS (
          SELECT 1 FROM "companies" c
          WHERE c."owner_id" = g."user_id"
            AND c."prepared_in_workspace_id" IS NOT NULL
            AND NOT (c."prepared_in_workspace_id" = ANY (g."workspace_ids"))
        )
        OR EXISTS (
          SELECT 1 FROM "workspace_memberships" m
          WHERE m."user_id" = g."user_id"
            AND m."role" = 'conseiller'
            AND NOT (m."workspace_id" = ANY (g."workspace_ids"))
        )
      );
  IF coalesce(current_setting('confluent.revoke_wider_grants', true), '') = 'on' THEN
    UPDATE "oauth_tokens" t SET "revoked_at" = (now() AT TIME ZONE 'UTC')
    FROM "pg_temp"."widened_grants" w
    WHERE t."grant_id" = w."id" AND t."revoked_at" IS NULL;
    UPDATE "oauth_grants" g SET "revoked_at" = (now() AT TIME ZONE 'UTC')
    FROM "pg_temp"."widened_grants" w
    WHERE g."id" = w."id";
    INSERT INTO "audit_log" ("id", "actor_id", "action_type", "metadata")
    SELECT gen_random_uuid()::text, w."user_id", 'oauth_grant_revoked'::"audit_action",
      jsonb_build_object('grantId', w."id", 'reason', 'migration_revert')
    FROM "pg_temp"."widened_grants" w;
  ELSE
    SELECT w."id" INTO widened FROM "pg_temp"."widened_grants" w LIMIT 1;
    IF widened IS NOT NULL THEN
      RAISE EXCEPTION 'connection (oauth grant) % would reach companies prepared in a workspace it was not allowed to reach: revoke it first, or SET LOCAL confluent.revoke_wider_grants = ''on'' to have this script revoke such connections', widened;
    END IF;
  END IF;
  DROP TABLE "pg_temp"."widened_grants";
END $$;

ALTER TABLE "oauth_grants" DROP CONSTRAINT IF EXISTS "oauth_grants_workspace_ids_check";
ALTER TABLE "oauth_grants" DROP COLUMN IF EXISTS "workspace_ids";
