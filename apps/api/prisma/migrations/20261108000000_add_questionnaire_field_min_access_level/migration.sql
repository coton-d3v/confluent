-- AlterTable
ALTER TABLE "questionnaire_fields" ADD COLUMN     "min_access_level" TEXT NOT NULL DEFAULT 'complet';

ALTER TABLE "questionnaire_fields" ADD CONSTRAINT "questionnaire_fields_min_access_level_check"
  CHECK ("min_access_level" IN ('public', 'partiel', 'complet'));

-- Backfill (decision 2026-11-08, story 12.1): which share level may read each section.
--   public  : project identity (V2 "Identité du projet", V1 "Présentation")
--   complet : financial data (V2 "Stade financier", V1 "Finances & équipe")
--   partiel : every other section
-- Any section not listed keeps the default 'complet' (fail closed).
UPDATE "questionnaire_fields" SET "min_access_level" = 'public'
WHERE "section" IN ('Identité du projet', 'Présentation');

UPDATE "questionnaire_fields" SET "min_access_level" = 'partiel'
WHERE "section" IN ('Ancrage régional', 'Origine & technologie', 'Stade spécifique', 'Marché & produit');
