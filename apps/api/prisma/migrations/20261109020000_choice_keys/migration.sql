-- ROADMAP E03.06: choices get stable keys; select answers store the key instead of the label.

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

ALTER TABLE "questionnaire_fields" ADD COLUMN "choices" JSONB NOT NULL DEFAULT '[]';

-- Keys from labels, in option order, unique within the field (R29): « A », « À », « A_2 » give `a`,
-- `a_2`, `a_2_2`. The label → key correspondence is kept to convert the answers deterministically.
CREATE TEMP TABLE "confluent_choice_keys" ("field_id" TEXT, "label" TEXT, "key" TEXT, "ord" INT);
DO $$
DECLARE
  f RECORD;
  lbl TEXT;
  taken TEXT[];
  k TEXT;
  i INT;
BEGIN
  FOR f IN SELECT "id", "options" FROM "questionnaire_fields" WHERE cardinality("options") > 0 LOOP
    taken := '{}';
    i := 0;
    FOREACH lbl IN ARRAY f."options" LOOP
      i := i + 1;
      k := pg_temp.confluent_unique_key(pg_temp.confluent_key(lbl), taken);
      taken := taken || k;
      INSERT INTO "confluent_choice_keys" VALUES (f."id", lbl, k, i);
    END LOOP;
    UPDATE "questionnaire_fields" SET "choices" = (
      SELECT jsonb_agg(jsonb_build_object('key', "key", 'label', "label") ORDER BY "ord")
      FROM "confluent_choice_keys" WHERE "field_id" = f."id"
    ) WHERE "id" = f."id";
  END LOOP;
END
$$;

-- Existing answers to a select field: label → key; a label listed twice maps to its first choice.
-- Answers matching no choice are kept as is.
UPDATE "dossier_answers" a SET "value" = m."key"
FROM (
  SELECT DISTINCT ON ("field_id", "label") "field_id", "label", "key"
  FROM "confluent_choice_keys" ORDER BY "field_id", "label", "ord"
) m, "questionnaire_fields" f
WHERE a."field_id" = m."field_id" AND f."id" = m."field_id" AND f."field_type" = 'select'
  AND a."value" = m."label";

-- Every choice key is unique within its field.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "questionnaire_fields" f, jsonb_array_elements(f."choices") c
    GROUP BY f."id", c->>'key' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'choice keys must be unique within a field';
  END IF;
END
$$;

DROP TABLE "confluent_choice_keys";

ALTER TABLE "questionnaire_fields" DROP COLUMN "options";

DROP FUNCTION pg_temp.confluent_unique_key(TEXT, TEXT[]);
DROP FUNCTION pg_temp.confluent_key(TEXT);
