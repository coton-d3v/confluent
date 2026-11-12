-- ROADMAP E06.04: an investor's pledge (E07.06) confirmed as financing in a candidature's plan
-- (E06.03), so that an intention and the financing it became are never added together (rules:
-- @confluent/shared `funding-plan.schema.ts`).
--
--  * `funding_plan_pledge_links`: the line of one plan that carries a pledge, and the pledge's
--    revision the owner confirmed (`pledge_version`, the opaque revision of E07.06, only ever
--    compared for equality). At most one pledge per line (`line_id` unique) and one line per pledge
--    in a plan (`(candidature_id, pledge_id)` unique). Composite foreign keys keep the line in that
--    candidature's plan (`(line_id, candidature_id)`) and the pledge on that candidature's request
--    (`(candidature_id, dossier_id)` and `(pledge_id, dossier_id)`). Removed with the line, the
--    candidature, the request or the pledge — a withdrawal removes the confirmation, never the line.
--  * The unique indexes `(id, candidature_id)` on `funding_plan_lines`, `(id, dossier_id)` on
--    `candidatures` and on `investor_pledges` are these foreign keys' targets; each is implied by the
--    table's primary key, so no existing row can break it.
--
-- CHECK: none — no column holds a closed list of values; the uniqueness and the foreign keys are the
-- table's whole rule. The journal reuses `funding_plan_updated`: no new `audit_action` value.
--
-- Backfill: none — no pledge was ever confirmed in a plan, the table starts empty; existing plans,
-- their lines and their totals are unchanged.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/funding-plan-pledges.pg-spec.ts).
-- Undone by prisma/checks/20261130000000_funding_plan_pledges.down.sql.

CREATE UNIQUE INDEX IF NOT EXISTS "funding_plan_lines_id_candidature_id_key" ON "funding_plan_lines"("id", "candidature_id");

CREATE UNIQUE INDEX IF NOT EXISTS "candidatures_id_dossier_id_key" ON "candidatures"("id", "dossier_id");

CREATE UNIQUE INDEX IF NOT EXISTS "investor_pledges_id_dossier_id_key" ON "investor_pledges"("id", "dossier_id");

CREATE TABLE IF NOT EXISTS "funding_plan_pledge_links" (
    "id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "pledge_id" TEXT NOT NULL,
    "pledge_version" INTEGER NOT NULL,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_plan_pledge_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "funding_plan_pledge_links_line_id_key" ON "funding_plan_pledge_links"("line_id");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_plan_pledge_links_candidature_id_pledge_id_key" ON "funding_plan_pledge_links"("candidature_id", "pledge_id");

CREATE INDEX IF NOT EXISTS "funding_plan_pledge_links_pledge_id_dossier_id_idx" ON "funding_plan_pledge_links"("pledge_id", "dossier_id");

CREATE INDEX IF NOT EXISTS "funding_plan_pledge_links_confirmed_by_id_idx" ON "funding_plan_pledge_links"("confirmed_by_id");

ALTER TABLE "funding_plan_pledge_links" DROP CONSTRAINT IF EXISTS "funding_plan_pledge_links_line_id_candidature_id_fkey";

ALTER TABLE "funding_plan_pledge_links" ADD CONSTRAINT "funding_plan_pledge_links_line_id_candidature_id_fkey" FOREIGN KEY ("line_id", "candidature_id") REFERENCES "funding_plan_lines"("id", "candidature_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "funding_plan_pledge_links" DROP CONSTRAINT IF EXISTS "funding_plan_pledge_links_candidature_id_dossier_id_fkey";

ALTER TABLE "funding_plan_pledge_links" ADD CONSTRAINT "funding_plan_pledge_links_candidature_id_dossier_id_fkey" FOREIGN KEY ("candidature_id", "dossier_id") REFERENCES "candidatures"("id", "dossier_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "funding_plan_pledge_links" DROP CONSTRAINT IF EXISTS "funding_plan_pledge_links_pledge_id_dossier_id_fkey";

ALTER TABLE "funding_plan_pledge_links" ADD CONSTRAINT "funding_plan_pledge_links_pledge_id_dossier_id_fkey" FOREIGN KEY ("pledge_id", "dossier_id") REFERENCES "investor_pledges"("id", "dossier_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "funding_plan_pledge_links" DROP CONSTRAINT IF EXISTS "funding_plan_pledge_links_confirmed_by_id_fkey";

ALTER TABLE "funding_plan_pledge_links" ADD CONSTRAINT "funding_plan_pledge_links_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
