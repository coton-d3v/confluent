-- ROADMAP E06.03: the financing plan of a request in one workspace, carried by its candidature (one
-- request × one workspace, E05.09) like its financing status (E06.01). States, limits and the
-- aggregates: @confluent/shared `funding-plan.schema.ts`.
--
--  * `funding_plan_lines`: one row per line of a candidature's plan — an amount in whole euros and a
--    state for one source category (E06.02) of the candidature's workspace, an optional detail, a
--    version that grows at each change, and which side (owner of the request or workspace) wrote it
--    last. Both foreign keys carry `workspace_id`: a line can only use a category of its
--    candidature's workspace. Removed with its candidature (a draft withdrawn, a request deleted);
--    a category in use cannot be deleted (none is: categories are deactivated, E06.02).
--  * Unique indexes on `candidatures (id, workspace_id)` and `funding_source_categories (id,
--    workspace_id)`: the targets of those foreign keys.
--
-- No backfill: no plan existed before; every candidature starts with an empty plan.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any
-- prefix of this file, then the whole file, gives the same database
-- (test/pg/funding-plans.pg-spec.ts). Undone by prisma/checks/20261119000000_funding_plans.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'funding_plan_updated';

CREATE UNIQUE INDEX IF NOT EXISTS "candidatures_id_workspace_id_key" ON "candidatures"("id", "workspace_id");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_source_categories_id_workspace_id_key" ON "funding_source_categories"("id", "workspace_id");

CREATE TABLE IF NOT EXISTS "funding_plan_lines" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "label" TEXT,
    "amount_eur" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_side" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "funding_plan_lines_candidature_id_idx" ON "funding_plan_lines"("candidature_id");

CREATE INDEX IF NOT EXISTS "funding_plan_lines_category_id_workspace_id_idx" ON "funding_plan_lines"("category_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "funding_plan_lines_updated_by_id_idx" ON "funding_plan_lines"("updated_by_id");

ALTER TABLE "funding_plan_lines" DROP CONSTRAINT IF EXISTS "funding_plan_lines_candidature_id_workspace_id_fkey";

ALTER TABLE "funding_plan_lines" ADD CONSTRAINT "funding_plan_lines_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "funding_plan_lines" DROP CONSTRAINT IF EXISTS "funding_plan_lines_category_id_workspace_id_fkey";

ALTER TABLE "funding_plan_lines" ADD CONSTRAINT "funding_plan_lines_category_id_workspace_id_fkey" FOREIGN KEY ("category_id", "workspace_id") REFERENCES "funding_source_categories"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "funding_plan_lines" DROP CONSTRAINT IF EXISTS "funding_plan_lines_updated_by_id_fkey";

ALTER TABLE "funding_plan_lines" ADD CONSTRAINT "funding_plan_lines_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closed state, amount as a request's (whole euros, 1 € to 1 billion), detail on one trimmed line,
-- known side.
ALTER TABLE "funding_plan_lines" DROP CONSTRAINT IF EXISTS "funding_plan_lines_check";

ALTER TABLE "funding_plan_lines" ADD CONSTRAINT "funding_plan_lines_check" CHECK (
  "state" IN ('planned', 'requested', 'obtained', 'refused')
  AND "amount_eur" BETWEEN 1 AND 1000000000
  AND ("label" IS NULL OR (
    char_length("label") BETWEEN 1 AND 120
    AND "label" = btrim("label")
    AND "label" !~ '[[:cntrl:]]'
  ))
  AND "version" >= 1
  AND "updated_by_side" IN ('owner', 'workspace')
);
