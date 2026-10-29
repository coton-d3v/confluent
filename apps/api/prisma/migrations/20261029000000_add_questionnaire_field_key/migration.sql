-- AlterTable
ALTER TABLE "questionnaire_fields" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_fields_version_id_key_key" ON "questionnaire_fields"("version_id", "key");

-- Backfill: give a stable key to the fields read by the classification, matched on the
-- labels seeded so far (V1 + V2). If a label appears twice in a version, only the first
-- occurrence gets the key (unique per version).
UPDATE "questionnaire_fields" AS f
SET "key" = m."key"
FROM (VALUES
  ('Secteur d''activité', 'secteur_activite'),
  ('Stade de maturité', 'stade_maturite'),
  ('Votre lien avec la région Centre Val de Loire', 'ancrage_cvl'),
  ('Secteur principal', 'secteur'),
  ('Avez-vous une structure juridique créée ?', 'structure_juridique'),
  ('Stade de financement actuel', 'stade_financement'),
  ('Origine du projet', 'origine_projet'),
  ('Votre projet repose-t-il sur une technologie difficile à reproduire ?', 'techno_difficile'),
  ('Avez-vous des brevets ?', 'brevets'),
  ('Y a-t-il un verrou scientifique non résolu ?', 'verrou_scientifique'),
  ('Financement R&D public (ANR, BPI, Horizon) ?', 'rd_public'),
  ('Stade du projet', 'stade_projet')
) AS m("label", "key")
WHERE f."label" = m."label"
  AND f."id" = (
    SELECT f2."id" FROM "questionnaire_fields" AS f2
    WHERE f2."version_id" = f."version_id" AND f2."label" = f."label"
    ORDER BY f2."section", f2."order_index", f2."id"
    LIMIT 1
  );
