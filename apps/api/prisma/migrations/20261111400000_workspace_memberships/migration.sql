-- ROADMAP E05.02: memberships of a workspace, distinct from the account's global role (`users.role`).
-- A new table: no existing row changes and nothing needs a backfill (no workspace has members yet;
-- financeurs keep reaching dossiers through their share links, entrepreneurs through ownership).
-- The CHECK constraints repeat the closed values and rules of the API
-- (@confluent/shared workspace-member.schema.ts): only an investisseur has an investor type, only a
-- conseiller may hold the right to manage the workspace.

CREATE TABLE "workspace_memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organization" TEXT,
    "investor_type" TEXT,
    "can_manage_workspace" BOOLEAN NOT NULL DEFAULT false,
    "invited_by_id" TEXT,
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_memberships_role_check"
      CHECK ("role" IN ('conseiller', 'investisseur')),
    CONSTRAINT "workspace_memberships_organization_check"
      CHECK ("organization" = btrim("organization") AND char_length("organization") BETWEEN 1 AND 120),
    CONSTRAINT "workspace_memberships_investor_type_check"
      CHECK ("investor_type" IN ('business_angel', 'fonds_investissement', 'banque', 'financeur_public', 'reseau_pret_honneur', 'autre')),
    CONSTRAINT "workspace_memberships_investor_type_role_check"
      CHECK ("investor_type" IS NULL OR "role" = 'investisseur'),
    CONSTRAINT "workspace_memberships_manager_role_check"
      CHECK (NOT "can_manage_workspace" OR "role" = 'conseiller')
);

CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships"("user_id");

CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");

ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "audit_action" ADD VALUE 'workspace_member_invited';
ALTER TYPE "audit_action" ADD VALUE 'workspace_member_updated';
ALTER TYPE "audit_action" ADD VALUE 'workspace_member_deactivated';
ALTER TYPE "audit_action" ADD VALUE 'workspace_member_reactivated';
