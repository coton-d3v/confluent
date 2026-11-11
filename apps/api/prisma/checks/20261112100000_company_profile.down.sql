-- Reverts migration 20261112100000_company_profile (ROADMAP E05.05) before the application is rolled
-- back to a version where answers and documents belong to the dossier (E05.04). Nothing is lost while
-- each company has a single dossier, which every version up to E05.05 guarantees: each answer and
-- document goes back to that dossier, same row, same id; the profile version is already on the
-- dossier. A company with several dossiers (from E05.07), or holding answers or documents without a
-- dossier (never left by the application), cannot go back: refused, nothing changed. Run in one
-- transaction (psql --single-transaction), then remove the migration's row so it can be applied
-- again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112100000_company_profile';
-- Exercised by test/pg/company-profile.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  shared TEXT;
BEGIN
  SELECT "company_id" INTO shared FROM "dossiers" GROUP BY "company_id" HAVING count(*) > 1 LIMIT 1;
  IF shared IS NOT NULL THEN
    RAISE EXCEPTION 'company % has several dossiers: its profile cannot go back to one dossier', shared;
  END IF;
  SELECT c."id" INTO shared FROM "companies" c
  WHERE NOT EXISTS (SELECT 1 FROM "dossiers" d WHERE d."company_id" = c."id")
    AND (EXISTS (SELECT 1 FROM "dossier_answers" a WHERE a."company_id" = c."id")
      OR EXISTS (SELECT 1 FROM "documents" x WHERE x."company_id" = c."id"))
  LIMIT 1;
  IF shared IS NOT NULL THEN
    RAISE EXCEPTION 'company % has answers or documents but no dossier to take them back', shared;
  END IF;
END $$;

-- Documents.
ALTER TABLE "documents" ADD COLUMN "dossier_id" TEXT;

UPDATE "documents" x SET "dossier_id" = d."id" FROM "dossiers" d WHERE d."company_id" = x."company_id";

ALTER TABLE "documents" ALTER COLUMN "dossier_id" SET NOT NULL;

ALTER TABLE "documents" DROP COLUMN "company_id";

CREATE INDEX "documents_dossier_id_idx" ON "documents"("dossier_id");

CREATE UNIQUE INDEX "documents_dossier_id_field_id_filename_version_key" ON "documents"("dossier_id", "field_id", "filename", "version");

ALTER TABLE "documents" ADD CONSTRAINT "documents_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Answers.
ALTER TABLE "dossier_answers" ADD COLUMN "dossier_id" TEXT;

UPDATE "dossier_answers" a SET "dossier_id" = d."id" FROM "dossiers" d WHERE d."company_id" = a."company_id";

ALTER TABLE "dossier_answers" ALTER COLUMN "dossier_id" SET NOT NULL;

ALTER TABLE "dossier_answers" DROP COLUMN "company_id";

CREATE UNIQUE INDEX "dossier_answers_dossier_id_field_id_key" ON "dossier_answers"("dossier_id", "field_id");

ALTER TABLE "dossier_answers" ADD CONSTRAINT "dossier_answers_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Profile version.
ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_company_id_questionnaire_version_id_fkey";

ALTER TABLE "companies" DROP COLUMN "profile_version_id";
