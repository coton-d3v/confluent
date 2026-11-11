-- ROADMAP E07.02: the publication of a financing request in a workspace's pool (« vivier »), with the
-- explicit consent of its owner. Rules: @confluent/shared `pool-publication.schema.ts`.
--
--  * `pool_publications`: one row per candidature (one request presented to one workspace, E05.09),
--    unique: the level the workspace's investors will read the request at (E07.03, the three levels
--    of nominative shares), the latest consent (`consented_at`, `consented_by_id`), and once withdrawn
--    its date, who withdrew it and why (`owner` | `archived`) — the row stays, a republication is a
--    new consent on it. The foreign key carries `workspace_id` (the candidatures' target is E06.03's
--    unique index): a publication never lands in another workspace's pool. Removed with its
--    candidature (that is, with its request); an account deleted leaves it without consenter or
--    withdrawer.
--  * `audit_action` gains `pool_publication_published` (publication, republication, change of level)
--    and `pool_publication_withdrawn` (by the owner, or with the archiving of the request).
--
-- Backfill: none — no request was ever published in a pool (the request's own publication, D03, is
-- not a consent to any pool), so the table starts empty and nothing else is touched.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any
-- prefix of this file, then the whole file, gives the same database
-- (test/pg/pool-publications.pg-spec.ts). Undone by
-- prisma/checks/20261124000000_pool_publications.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'pool_publication_published';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'pool_publication_withdrawn';

CREATE TABLE IF NOT EXISTS "pool_publications" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "access_level" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "consented_by_id" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by_id" TEXT,
    "withdrawal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pool_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pool_publications_candidature_id_key" ON "pool_publications"("candidature_id");

CREATE INDEX IF NOT EXISTS "pool_publications_workspace_id_withdrawn_at_idx" ON "pool_publications"("workspace_id", "withdrawn_at");

CREATE INDEX IF NOT EXISTS "pool_publications_consented_by_id_idx" ON "pool_publications"("consented_by_id");

CREATE INDEX IF NOT EXISTS "pool_publications_withdrawn_by_id_idx" ON "pool_publications"("withdrawn_by_id");

ALTER TABLE "pool_publications" DROP CONSTRAINT IF EXISTS "pool_publications_candidature_id_workspace_id_fkey";

ALTER TABLE "pool_publications" ADD CONSTRAINT "pool_publications_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "pool_publications" DROP CONSTRAINT IF EXISTS "pool_publications_consented_by_id_fkey";

ALTER TABLE "pool_publications" ADD CONSTRAINT "pool_publications_consented_by_id_fkey" FOREIGN KEY ("consented_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pool_publications" DROP CONSTRAINT IF EXISTS "pool_publications_withdrawn_by_id_fkey";

ALTER TABLE "pool_publications" ADD CONSTRAINT "pool_publications_withdrawn_by_id_fkey" FOREIGN KEY ("withdrawn_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The three levels of nominative shares (@confluent/shared `access-level.schema.ts`).
ALTER TABLE "pool_publications" DROP CONSTRAINT IF EXISTS "pool_publications_access_level_check";

ALTER TABLE "pool_publications" ADD CONSTRAINT "pool_publications_access_level_check"
  CHECK ("access_level" IN ('public', 'partiel', 'complet'));

-- Withdrawn exactly when a reason is given, among `owner` and `archived`; who withdrew it only then;
-- never before the consent it ends.
ALTER TABLE "pool_publications" DROP CONSTRAINT IF EXISTS "pool_publications_withdrawal_check";

ALTER TABLE "pool_publications" ADD CONSTRAINT "pool_publications_withdrawal_check" CHECK (
  ("withdrawn_at" IS NULL) = ("withdrawal_reason" IS NULL)
  AND ("withdrawal_reason" IS NULL OR "withdrawal_reason" IN ('owner', 'archived'))
  AND ("withdrawn_by_id" IS NULL OR "withdrawn_at" IS NOT NULL)
  AND ("withdrawn_at" IS NULL OR "withdrawn_at" >= "consented_at")
);
