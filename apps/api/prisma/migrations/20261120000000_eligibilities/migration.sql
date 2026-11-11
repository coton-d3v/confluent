-- ROADMAP E06.05: schemes (« dispositifs » — JEIR, JEI, CIR and others) as declarative information
-- and filters, never a tax simulation. Default list, limits and sides: @confluent/shared
-- `eligibility.schema.ts`.
--
--  * `eligibility_schemes`: one row per scheme of a workspace — `key` (stable, unique in the
--    workspace) fixed at creation; `label` (unique in the workspace), `description`, `position` and
--    `active` configured by its managers. Deactivated, never deleted; removed with its workspace only.
--  * `candidature_eligibilities`: a candidature's eligibility to one scheme of its workspace — who
--    declared it (owner of the request or workspace), an optional note, when and by whom the
--    workspace verified it, a version that grows at each change, and which side wrote it last. Both
--    foreign keys carry `workspace_id` (the candidatures' target is E06.03's unique index): an
--    eligibility can only use a scheme of its candidature's workspace. One per candidature and
--    scheme. Removed with its candidature; a scheme in use cannot be deleted.
--
-- Backfill, explicit: every existing workspace gets the five default schemes, in order, active, with
-- an id derived from the workspace and the key (the same on every run). A workspace created
-- afterwards gets them from the API, in the transaction that creates it. No eligibility existed
-- before: none is backfilled.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill
-- skipping the schemes already there), so any prefix of this file, then the whole file, gives the
-- same database (test/pg/eligibilities.pg-spec.ts). Undone by
-- prisma/checks/20261120000000_eligibilities.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'eligibility_schemes_updated';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_eligibility_updated';

CREATE TABLE IF NOT EXISTS "eligibility_schemes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eligibility_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "eligibility_schemes_workspace_id_key_key" ON "eligibility_schemes"("workspace_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "eligibility_schemes_workspace_id_label_key" ON "eligibility_schemes"("workspace_id", "label");

CREATE UNIQUE INDEX IF NOT EXISTS "eligibility_schemes_id_workspace_id_key" ON "eligibility_schemes"("id", "workspace_id");

ALTER TABLE "eligibility_schemes" DROP CONSTRAINT IF EXISTS "eligibility_schemes_workspace_id_fkey";

ALTER TABLE "eligibility_schemes" ADD CONSTRAINT "eligibility_schemes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Key as the API derives it; label and description on one line, trimmed and bounded.
ALTER TABLE "eligibility_schemes" DROP CONSTRAINT IF EXISTS "eligibility_schemes_check";

ALTER TABLE "eligibility_schemes" ADD CONSTRAINT "eligibility_schemes_check" CHECK (
  "key" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
  AND char_length("key") <= 60
  AND char_length("label") BETWEEN 1 AND 80
  AND "label" = btrim("label")
  AND "label" !~ '[[:cntrl:]]'
  AND ("description" IS NULL OR (
    char_length("description") BETWEEN 1 AND 300
    AND "description" = btrim("description")
    AND "description" !~ '[[:cntrl:]]'
  ))
  AND "position" >= 0
);

CREATE TABLE IF NOT EXISTS "candidature_eligibilities" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "scheme_id" TEXT NOT NULL,
    "note" TEXT,
    "declared_by_side" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_side" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidature_eligibilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidature_eligibilities_candidature_id_scheme_id_key" ON "candidature_eligibilities"("candidature_id", "scheme_id");

CREATE INDEX IF NOT EXISTS "candidature_eligibilities_scheme_id_workspace_id_idx" ON "candidature_eligibilities"("scheme_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "candidature_eligibilities_verified_by_id_idx" ON "candidature_eligibilities"("verified_by_id");

CREATE INDEX IF NOT EXISTS "candidature_eligibilities_updated_by_id_idx" ON "candidature_eligibilities"("updated_by_id");

ALTER TABLE "candidature_eligibilities" DROP CONSTRAINT IF EXISTS "candidature_eligibilities_candidature_id_workspace_id_fkey";

ALTER TABLE "candidature_eligibilities" ADD CONSTRAINT "candidature_eligibilities_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "candidature_eligibilities" DROP CONSTRAINT IF EXISTS "candidature_eligibilities_scheme_id_workspace_id_fkey";

ALTER TABLE "candidature_eligibilities" ADD CONSTRAINT "candidature_eligibilities_scheme_id_workspace_id_fkey" FOREIGN KEY ("scheme_id", "workspace_id") REFERENCES "eligibility_schemes"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "candidature_eligibilities" DROP CONSTRAINT IF EXISTS "candidature_eligibilities_verified_by_id_fkey";

ALTER TABLE "candidature_eligibilities" ADD CONSTRAINT "candidature_eligibilities_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_eligibilities" DROP CONSTRAINT IF EXISTS "candidature_eligibilities_updated_by_id_fkey";

ALTER TABLE "candidature_eligibilities" ADD CONSTRAINT "candidature_eligibilities_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Known sides; note on one trimmed line; a verifier only with a verification date (the verifier's
-- account may disappear: the date stays).
ALTER TABLE "candidature_eligibilities" DROP CONSTRAINT IF EXISTS "candidature_eligibilities_check";

ALTER TABLE "candidature_eligibilities" ADD CONSTRAINT "candidature_eligibilities_check" CHECK (
  "declared_by_side" IN ('owner', 'workspace')
  AND "updated_by_side" IN ('owner', 'workspace')
  AND ("note" IS NULL OR (
    char_length("note") BETWEEN 1 AND 200
    AND "note" = btrim("note")
    AND "note" !~ '[[:cntrl:]]'
  ))
  AND ("verified_by_id" IS NULL OR "verified_at" IS NOT NULL)
  AND "version" >= 1
);

-- Backfill: the default schemes for every existing workspace. The id is a version-4 shaped UUID (as
-- the API's ids, which the contracts validate) drawn from md5(workspace, key).
INSERT INTO "eligibility_schemes" ("id", "workspace_id", "key", "label", "description", "position", "active", "updated_at")
SELECT
  substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12),
  "workspace_id", "key", "label", "description", "position", true, CURRENT_TIMESTAMP
FROM (
  SELECT md5('eligibility-scheme:' || w."id" || ':' || d."key") AS h, w."id" AS "workspace_id", d.*
  FROM "workspaces" w
  CROSS JOIN (VALUES
    ('jeir', 'JEIR', 'Jeune entreprise innovante de rupture (statut fiscal de l’entreprise).', 0),
    ('jei', 'JEI', 'Jeune entreprise innovante (statut fiscal de l’entreprise).', 1),
    ('cir', 'CIR', 'Crédit d’impôt recherche, au titre des dépenses de recherche de l’entreprise.', 2),
    ('cii', 'CII', 'Crédit d’impôt innovation, au titre des dépenses d’innovation d’une PME.', 3),
    ('ir_pme', 'IR-PME', 'Réduction d’impôt sur le revenu des personnes qui souscrivent au capital de la PME (dite « Madelin »).', 4)
  ) AS d("key", "label", "description", "position")
) AS backfill
ON CONFLICT DO NOTHING;
