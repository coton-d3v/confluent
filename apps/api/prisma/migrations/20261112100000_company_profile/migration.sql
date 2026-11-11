-- ROADMAP E05.05: the common profile (D01) moves from the dossier to its company. The company now
-- holds the form version its profile answers, the answers (with their provenance and, through
-- `answer_id`, their history) and the documents (every version, attached to a question or not).
-- A dossier keeps its name, slug, submission, classification, share links and journal, and reads
-- its company's profile. Rows keep their ids: answers, revisions, documents, cited sources, share
-- tokens and URLs are unchanged, and no stored file moves (storage keys are opaque).
--
-- Backfill: since E05.04 every company has exactly one dossier, so the move is one-to-one. A company
-- with several dossiers would have its profiles merged: the migration refuses it instead (guard). A
-- company without dossier (none through the application) holds no answer and gets the version a new
-- company gets.
--
-- `dossiers.questionnaire_version_id` stays, as `user_id` did in E05.04: the
-- (company_id, questionnaire_version_id) foreign key keeps it equal to `companies.profile_version_id`
-- and lets an explicit migration of the profile to another version (E03.08) cascade to the dossiers.
--
-- Deployment resume: Prisma runs this file as one transaction, so an interrupted deployment leaves
-- nothing behind. Each statement can also run again on a partly migrated database (IF [NOT] EXISTS,
-- backfill of missing values only, constraints dropped before being added, backfills skipped once
-- `dossier_id` is gone): applying any prefix of this file, then the whole file, gives the same
-- result (test/pg/company-profile.pg-spec.ts). Undone by
-- prisma/checks/20261112100000_company_profile.down.sql.

-- Guard: one dossier per company, the state E05.04 left.
DO $$
DECLARE
  shared TEXT;
BEGIN
  SELECT "company_id" INTO shared FROM "dossiers" GROUP BY "company_id" HAVING count(*) > 1 LIMIT 1;
  IF shared IS NOT NULL THEN
    RAISE EXCEPTION 'E05.05: company % has several dossiers; their profiles cannot be merged by this migration', shared;
  END IF;
END $$;

-- 1. The profile's form version, taken from the company's dossier.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "profile_version_id" TEXT;

UPDATE "companies" c
SET "profile_version_id" = d."questionnaire_version_id"
FROM "dossiers" d
WHERE d."company_id" = c."id" AND c."profile_version_id" IS NULL;

-- A company without dossier (the application never leaves one, E05.04) has no answers: it gets the
-- version a new company gets, the published one of the form assigned to company profiles.
UPDATE "companies" c
SET "profile_version_id" = (
  SELECT v."id" FROM "questionnaire_versions" v
  JOIN "questionnaires" q ON q."id" = v."questionnaire_id"
  WHERE q."usage" = 'dossier' AND v."status" = 'published'
  ORDER BY v."version" DESC
  LIMIT 1
)
WHERE c."profile_version_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "dossiers" d WHERE d."company_id" = c."id");

DO $$
DECLARE
  orphan TEXT;
BEGIN
  SELECT "id" INTO orphan FROM "companies" WHERE "profile_version_id" IS NULL LIMIT 1;
  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION 'E05.05: company % has no dossier and no published company-profile form exists', orphan;
  END IF;
END $$;

ALTER TABLE "companies" ALTER COLUMN "profile_version_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "companies_profile_version_id_idx" ON "companies"("profile_version_id");

CREATE UNIQUE INDEX IF NOT EXISTS "companies_id_profile_version_id_key" ON "companies"("id", "profile_version_id");

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_profile_version_id_fkey";

ALTER TABLE "companies" ADD CONSTRAINT "companies_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "questionnaire_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_company_id_questionnaire_version_id_fkey";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_company_id_questionnaire_version_id_fkey" FOREIGN KEY ("company_id", "questionnaire_version_id") REFERENCES "companies"("id", "profile_version_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 2. Answers: from the dossier to its company.
ALTER TABLE "dossier_answers" ADD COLUMN IF NOT EXISTS "company_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'dossier_answers' AND column_name = 'dossier_id'
  ) THEN
    EXECUTE 'UPDATE "dossier_answers" a SET "company_id" = d."company_id"
             FROM "dossiers" d
             WHERE d."id" = a."dossier_id" AND a."company_id" IS NULL';
  END IF;
END $$;

ALTER TABLE "dossier_answers" ALTER COLUMN "company_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "dossier_answers_company_id_field_id_key" ON "dossier_answers"("company_id", "field_id");

ALTER TABLE "dossier_answers" DROP CONSTRAINT IF EXISTS "dossier_answers_company_id_fkey";

ALTER TABLE "dossier_answers" ADD CONSTRAINT "dossier_answers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Also drops its unique index and foreign key.
ALTER TABLE "dossier_answers" DROP COLUMN IF EXISTS "dossier_id";

-- 3. Documents: from the dossier to its company, every version.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "company_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'documents' AND column_name = 'dossier_id'
  ) THEN
    EXECUTE 'UPDATE "documents" x SET "company_id" = d."company_id"
             FROM "dossiers" d
             WHERE d."id" = x."dossier_id" AND x."company_id" IS NULL';
  END IF;
END $$;

ALTER TABLE "documents" ALTER COLUMN "company_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "documents_company_id_idx" ON "documents"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "documents_company_id_field_id_filename_version_key" ON "documents"("company_id", "field_id", "filename", "version");

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_company_id_fkey";

ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Also drops its indexes and foreign key.
ALTER TABLE "documents" DROP COLUMN IF EXISTS "dossier_id";
