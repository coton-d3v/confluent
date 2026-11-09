-- Provenance of the stored classification (code review R31): for each column, the field keys of the
-- dossier's version it was computed from. A share level is judged on them, so a later change of the
-- rules never reveals a value computed from a field that the share hides.
ALTER TABLE "dossiers" ADD COLUMN "classification_sources" JSONB;

-- Backfill of the dossiers already classified. The rules in place now are those that computed them:
-- this migration ships with the configurable rules (20261109040000), seeded identical to the former
-- hard-coded classification, before any administrator can change them. Columns without any source
-- are left out, hence hidden from every share (closed by default).
WITH column_dimensions ("column_name", "dimension") AS (
  VALUES
    ('sector', 'sector'),
    ('maturityStage', 'maturity_stage'),
    ('ancrageCvl', 'ancrage_cvl'),
    ('tagTechnologique', 'non_tech'),
    ('tagTechnologique', 'deeptech_signal'),
    ('deeptechScore', 'non_tech'),
    ('deeptechScore', 'deeptech_signal'),
    ('axe1Projet', 'axe1_projet'),
    ('axe2Financier', 'axe2_financier'),
    ('axe3Origine', 'axe3_origine'),
    ('preCreation', 'pre_creation')
),
sources AS (
  SELECT d."id", c."column_name", array_agg(DISTINCT r."field_key" ORDER BY r."field_key") AS "keys"
  FROM "dossiers" d
  JOIN "questionnaire_fields" f ON f."version_id" = d."questionnaire_version_id"
  JOIN "classification_rules" r ON r."field_key" = f."key"
  JOIN column_dimensions c ON c."dimension" = r."dimension"
  WHERE d."submitted_at" IS NOT NULL
  GROUP BY d."id", c."column_name"
)
UPDATE "dossiers" d
SET "classification_sources" = s."by_column"
FROM (
  SELECT "id", jsonb_object_agg("column_name", to_jsonb("keys")) AS "by_column"
  FROM sources
  GROUP BY "id"
) s
WHERE s."id" = d."id";
