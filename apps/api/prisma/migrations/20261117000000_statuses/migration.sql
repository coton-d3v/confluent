-- ROADMAP E06.01, decision D03 « Statuts et clôture » (proposal, still to be confirmed): the
-- publication of a financing request and its financing status in each workspace are two separate
-- things. Closed lists and transitions: @confluent/shared `status.schema.ts`.
--
--  * `dossiers.publication_status` gains `archived` (a closed request), with `archived_at` set
--    exactly while archived, as `published_at` is exactly while published.
--  * `candidatures.financing_status`: the request's financing status in the workspace the
--    candidature presents it to — `preparing`, `in_committee`, `funded`, `refused`, `abandoned` —,
--    `preparing` until the candidature is sent; `financing_status_changed_at` dates the current one.
--  * `candidature_status_changes`: one row per change (from, to, side, who, when), never updated.
--
-- Backfill, explicit: every existing candidature is `preparing` (no structure has decided anything
-- yet), dated from its sending, or its creation while a draft; no change is recorded. No existing
-- request is archived: every dossier keeps its publication (`draft`/`published`) and gets
-- `archived_at` NULL, which the new CHECK requires.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill
-- limited to the rows still empty), so any prefix of this file, then the whole file, gives the same
-- database (test/pg/statuses.pg-spec.ts). Undone by prisma/checks/20261117000000_statuses.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_archived';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_unarchived';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_status_changed';

-- 1. Publication: a request can be archived.
ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_publication_status_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_publication_status_check" CHECK (
  "publication_status" IN ('draft', 'published', 'archived')
  AND ("publication_status" = 'published') = ("published_at" IS NOT NULL)
  AND ("publication_status" = 'archived') = ("archived_at" IS NOT NULL)
);

-- 2. Financing status of each candidature, backfilled before it becomes mandatory.
ALTER TABLE "candidatures" ADD COLUMN IF NOT EXISTS "financing_status" TEXT;

ALTER TABLE "candidatures" ADD COLUMN IF NOT EXISTS "financing_status_changed_at" TIMESTAMP(3);

UPDATE "candidatures" SET "financing_status" = 'preparing' WHERE "financing_status" IS NULL;

UPDATE "candidatures" SET "financing_status_changed_at" = COALESCE("submitted_at", "created_at")
WHERE "financing_status_changed_at" IS NULL;

ALTER TABLE "candidatures" ALTER COLUMN "financing_status" SET DEFAULT 'preparing';

ALTER TABLE "candidatures" ALTER COLUMN "financing_status" SET NOT NULL;

ALTER TABLE "candidatures" ALTER COLUMN "financing_status_changed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "candidatures" ALTER COLUMN "financing_status_changed_at" SET NOT NULL;

-- A closed list; a draft stays `preparing` (the workspace decides nothing about what it cannot read).
ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_financing_status_check";

ALTER TABLE "candidatures" ADD CONSTRAINT "candidatures_financing_status_check" CHECK (
  "financing_status" IN ('preparing', 'in_committee', 'funded', 'refused', 'abandoned')
  AND ("financing_status" = 'preparing' OR "submitted_at" IS NOT NULL)
);

-- 3. The journal of the changes.
CREATE TABLE IF NOT EXISTS "candidature_status_changes" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "actor_side" TEXT NOT NULL,
    "actor_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidature_status_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "candidature_status_changes_candidature_id_idx" ON "candidature_status_changes"("candidature_id");

CREATE INDEX IF NOT EXISTS "candidature_status_changes_actor_id_idx" ON "candidature_status_changes"("actor_id");

ALTER TABLE "candidature_status_changes" DROP CONSTRAINT IF EXISTS "candidature_status_changes_candidature_id_fkey";

ALTER TABLE "candidature_status_changes" ADD CONSTRAINT "candidature_status_changes_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "candidatures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidature_status_changes" DROP CONSTRAINT IF EXISTS "candidature_status_changes_actor_id_fkey";

ALTER TABLE "candidature_status_changes" ADD CONSTRAINT "candidature_status_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_status_changes" DROP CONSTRAINT IF EXISTS "candidature_status_changes_check";

ALTER TABLE "candidature_status_changes" ADD CONSTRAINT "candidature_status_changes_check" CHECK (
  "from_status" IN ('preparing', 'in_committee', 'funded', 'refused', 'abandoned')
  AND "to_status" IN ('preparing', 'in_committee', 'funded', 'refused', 'abandoned')
  AND "from_status" <> "to_status"
  AND "actor_side" IN ('owner', 'workspace')
);
