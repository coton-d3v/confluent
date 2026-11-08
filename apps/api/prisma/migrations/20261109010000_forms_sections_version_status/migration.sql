-- ROADMAP E03.01 / E03.02 / E03.03 / E03.06: forms, version status, ordered sections, mandatory keys.

-- Session-scoped helpers (dropped at the end): `confluent_key` derives a key like `toKey` in the
-- API; `confluent_unique_key` suffixes it like `uniqueKey` (`base_2`, `base_3`…) until it is not in
-- `taken`. CREATE OR REPLACE: several migrations run in the same session during one deploy.
CREATE OR REPLACE FUNCTION pg_temp.confluent_key(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN s = '' THEN 'champ' WHEN s ~ '^[a-z]' THEN s ELSE 'f_' || s END
  FROM (
    SELECT left(regexp_replace(regexp_replace(lower(translate(t,
      'ÀÂÄÁÃÉÈÊËÎÏÍÔÖÓÕÙÛÜÚÇàâäáãéèêëîïíôöóõùûüúç',
      'AAAAAEEEEIIIOOOOUUUUCaaaaaeeeeiiioooouuuuc')), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 60) AS s
  ) x
$$;
CREATE OR REPLACE FUNCTION pg_temp.confluent_unique_key(base TEXT, taken TEXT[]) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k TEXT := base;
  n INT := 2;
BEGIN
  WHILE k = ANY(taken) LOOP
    k := left(base, 56) || '_' || n;
    n := n + 1;
  END LOOP;
  RETURN k;
END
$$;

-- 1. Forms. Every existing version belongs to the company-profile form.
CREATE TABLE "questionnaires" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "questionnaires_usage_check" CHECK ("usage" IN ('dossier'))
);
CREATE UNIQUE INDEX "questionnaires_slug_key" ON "questionnaires"("slug");
INSERT INTO "questionnaires" ("id", "slug", "name", "usage")
VALUES (gen_random_uuid()::text, 'profil-entreprise', 'Profil de l''entreprise', 'dossier');

-- 2. Versions: owner form, explicit status, publication date.
ALTER TABLE "questionnaire_versions"
  ADD COLUMN "questionnaire_id" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "published_at" TIMESTAMP(3);
UPDATE "questionnaire_versions" SET
  "questionnaire_id" = (SELECT "id" FROM "questionnaires" WHERE "slug" = 'profil-entreprise'),
  "status" = CASE WHEN "is_published" THEN 'published' ELSE 'archived' END,
  "published_at" = "created_at";
ALTER TABLE "questionnaire_versions"
  ALTER COLUMN "questionnaire_id" SET NOT NULL,
  DROP COLUMN "is_published",
  ADD CONSTRAINT "questionnaire_versions_status_check" CHECK ("status" IN ('draft', 'published', 'archived'));
DROP INDEX "questionnaire_versions_version_key";
CREATE UNIQUE INDEX "questionnaire_versions_questionnaire_id_version_key" ON "questionnaire_versions"("questionnaire_id", "version");
CREATE INDEX "questionnaire_versions_questionnaire_id_status_idx" ON "questionnaire_versions"("questionnaire_id", "status");
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_questionnaire_id_fkey"
  FOREIGN KEY ("questionnaire_id") REFERENCES "questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Sections, from the former free-text column, in the order the seeds intended (then alphabetical).
CREATE TABLE "questionnaire_sections" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    CONSTRAINT "questionnaire_sections_pkey" PRIMARY KEY ("id")
);
-- Keys unique within the version (R28): « Équipe » and « Equipe » give `equipe` and `equipe_2`.
DO $$
DECLARE
  v RECORD;
  sec RECORD;
  taken TEXT[];
  k TEXT;
BEGIN
  FOR v IN SELECT DISTINCT "version_id" FROM "questionnaire_fields" LOOP
    taken := '{}';
    FOR sec IN
      SELECT "section", (ROW_NUMBER() OVER (ORDER BY "rank", "section"))::int - 1 AS "idx"
      FROM (
        SELECT DISTINCT "section",
          CASE "section"
            WHEN 'Présentation' THEN 0 WHEN 'Marché & produit' THEN 1 WHEN 'Finances & équipe' THEN 2
            WHEN 'Ancrage régional' THEN 0 WHEN 'Identité du projet' THEN 1 WHEN 'Stade financier' THEN 2
            WHEN 'Origine & technologie' THEN 3 WHEN 'Stade spécifique' THEN 4
            ELSE 100 END AS "rank"
        FROM "questionnaire_fields" WHERE "version_id" = v."version_id"
      ) s
      ORDER BY "idx"
    LOOP
      k := pg_temp.confluent_unique_key(pg_temp.confluent_key(sec."section"), taken);
      taken := taken || k;
      INSERT INTO "questionnaire_sections" ("id", "version_id", "key", "title", "order_index")
      VALUES (gen_random_uuid()::text, v."version_id", k, sec."section", sec."idx");
    END LOOP;
  END LOOP;
END
$$;
CREATE UNIQUE INDEX "questionnaire_sections_version_id_key_key" ON "questionnaire_sections"("version_id", "key");
ALTER TABLE "questionnaire_sections" ADD CONSTRAINT "questionnaire_sections_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "questionnaire_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Fields: section reference, help text, constraints, and a key for every field.
ALTER TABLE "questionnaire_fields"
  ADD COLUMN "section_id" TEXT,
  ADD COLUMN "help_text" TEXT,
  ADD COLUMN "constraints" JSONB NOT NULL DEFAULT '{}';
UPDATE "questionnaire_fields" f SET "section_id" = s."id"
FROM "questionnaire_sections" s
WHERE s."version_id" = f."version_id" AND s."title" = f."section";

-- Every field gets a key (R28): existing keys are kept and reserved first, then generated keys
-- skip every key already taken in the version — including suffixed ones such as an explicit `nom_2`.
DO $$
DECLARE
  v RECORD;
  f RECORD;
  taken TEXT[];
  k TEXT;
BEGIN
  FOR v IN SELECT DISTINCT "version_id" FROM "questionnaire_fields" LOOP
    SELECT coalesce(array_agg("key"), '{}') INTO taken
    FROM "questionnaire_fields" WHERE "version_id" = v."version_id" AND "key" IS NOT NULL;
    FOR f IN
      SELECT "id", "label" FROM "questionnaire_fields"
      WHERE "version_id" = v."version_id" AND "key" IS NULL
      ORDER BY "order_index", "id"
    LOOP
      k := pg_temp.confluent_unique_key(pg_temp.confluent_key(f."label"), taken);
      taken := taken || k;
      UPDATE "questionnaire_fields" SET "key" = k WHERE "id" = f."id";
    END LOOP;
  END LOOP;
END
$$;

ALTER TABLE "questionnaire_fields"
  ALTER COLUMN "section_id" SET NOT NULL,
  ALTER COLUMN "key" SET NOT NULL,
  DROP COLUMN "section";
ALTER TABLE "questionnaire_fields" ADD CONSTRAINT "questionnaire_fields_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "questionnaire_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP FUNCTION pg_temp.confluent_unique_key(TEXT, TEXT[]);
DROP FUNCTION pg_temp.confluent_key(TEXT);
