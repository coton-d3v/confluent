-- ROADMAP E07.07: an investor's consent to show a structure their position on a request — their
-- mark of interest (E07.05) and their pledge (E07.06) — (rules: @confluent/shared
-- `position.schema.ts`).
--
--  * `investor_position_disclosures`: at most one consent per (request, investor, workspace) —
--    unique —, given explicitly by the investor (no default: a row exists only once they ticked it)
--    on a request they read through that workspace's pool; withdrawn by deleting the row. Whether it
--    still shows anything (the investor still reads the request through that pool) is read at each
--    request, never stored here. Removed with the request, the account or the workspace.
--  * `audit_action` gains `investor_position_disclosed` and `investor_position_disclosure_withdrawn`;
--    both hidden from the request's owner.
--
-- CHECK: none — no column holds a closed list of values; the uniqueness and the foreign keys are the
-- table's whole rule.
--
-- Backfill: none — no structure was ever shown a position, the table starts empty and nothing else
-- is touched.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix
-- of this file, then the whole file, gives the same database (test/pg/positions.pg-spec.ts). Undone
-- by prisma/checks/20261128000000_position_disclosures.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_position_disclosed';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_position_disclosure_withdrawn';

CREATE TABLE IF NOT EXISTS "investor_position_disclosures" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_position_disclosures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "investor_position_disclosures_dossier_id_investor_id_worksp_key" ON "investor_position_disclosures"("dossier_id", "investor_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "investor_position_disclosures_investor_id_idx" ON "investor_position_disclosures"("investor_id");

CREATE INDEX IF NOT EXISTS "investor_position_disclosures_workspace_id_dossier_id_idx" ON "investor_position_disclosures"("workspace_id", "dossier_id");

ALTER TABLE "investor_position_disclosures" DROP CONSTRAINT IF EXISTS "investor_position_disclosures_dossier_id_fkey";

ALTER TABLE "investor_position_disclosures" ADD CONSTRAINT "investor_position_disclosures_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investor_position_disclosures" DROP CONSTRAINT IF EXISTS "investor_position_disclosures_investor_id_fkey";

ALTER TABLE "investor_position_disclosures" ADD CONSTRAINT "investor_position_disclosures_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investor_position_disclosures" DROP CONSTRAINT IF EXISTS "investor_position_disclosures_workspace_id_fkey";

ALTER TABLE "investor_position_disclosures" ADD CONSTRAINT "investor_position_disclosures_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
