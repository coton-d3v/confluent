-- ROADMAP E07.05: an investor's mark of interest in a financing request (rules: @confluent/shared
-- `interest.schema.ts`).
--
--  * `investor_interests`: at most one mark per (request, investor) — unique —, with the investor's
--    consent to be named to the request's owner (`name_visible`, off by default, D05). A withdrawal
--    deletes the row. Who still counts (the investor reads the request as an opportunity, E07.03) is
--    read at each request, never stored here. Removed with the request or with the account.
--  * `audit_action` gains `investor_interest_marked` (a mark, or a change of its name visibility) and
--    `investor_interest_withdrawn`; both hidden from the request's owner, whose view is the count and
--    the names shown.
--
-- No column holds a closed set of text values (a boolean only), hence no CHECK constraint.
--
-- Backfill: none — no interest was ever marked, the table starts empty and nothing else is touched.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix
-- of this file, then the whole file, gives the same database (test/pg/interests.pg-spec.ts). Undone by
-- prisma/checks/20261126000000_investor_interests.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_interest_marked';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'investor_interest_withdrawn';

CREATE TABLE IF NOT EXISTS "investor_interests" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "name_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_interests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "investor_interests_dossier_id_investor_id_key" ON "investor_interests"("dossier_id", "investor_id");

CREATE INDEX IF NOT EXISTS "investor_interests_investor_id_idx" ON "investor_interests"("investor_id");

ALTER TABLE "investor_interests" DROP CONSTRAINT IF EXISTS "investor_interests_dossier_id_fkey";

ALTER TABLE "investor_interests" ADD CONSTRAINT "investor_interests_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investor_interests" DROP CONSTRAINT IF EXISTS "investor_interests_investor_id_fkey";

ALTER TABLE "investor_interests" ADD CONSTRAINT "investor_interests_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
