-- Reverts migration 20261115000000_workspace_forms (ROADMAP E05.09) before the application is rolled
-- back to E05.08. Confluent's own forms, companies, dossiers, profile answers and documents keep
-- their rows and ids. Lost on the way back: the workspaces' forms (with their versions), the
-- candidatures and their answers, and their journal entries; the three values added to
-- `audit_action` stay (PostgreSQL cannot remove them; unused).
--
-- That loss is the workspaces' and the entrepreneurs' data, so the revert refuses while a workspace
-- form or a candidature exists, unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_workspace_forms_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115000000_workspace_forms';
-- Exercised by test/pg/workspace-forms.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_workspace_forms_loss', true), '') <> 'on' THEN
    SELECT "id" INTO found FROM "questionnaires" WHERE "workspace_id" IS NOT NULL LIMIT 1;
    IF found IS NULL THEN
      SELECT "id" INTO found FROM "candidatures" LIMIT 1;
    END IF;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'workspace forms or candidatures exist (%): they would be lost; SET LOCAL confluent.accept_workspace_forms_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" IN ('candidature_created', 'candidature_submitted', 'candidature_withdrawn');

DROP TABLE IF EXISTS "candidature_answer_revisions";

DROP TABLE IF EXISTS "candidature_answers";

DROP TABLE IF EXISTS "candidatures";

DELETE FROM "questionnaire_fields" WHERE "version_id" IN (
  SELECT v."id" FROM "questionnaire_versions" v
  JOIN "questionnaires" q ON q."id" = v."questionnaire_id"
  WHERE q."workspace_id" IS NOT NULL
);

DELETE FROM "questionnaire_sections" WHERE "version_id" IN (
  SELECT v."id" FROM "questionnaire_versions" v
  JOIN "questionnaires" q ON q."id" = v."questionnaire_id"
  WHERE q."workspace_id" IS NOT NULL
);

DELETE FROM "questionnaire_versions" WHERE "questionnaire_id" IN (
  SELECT "id" FROM "questionnaires" WHERE "workspace_id" IS NOT NULL
);

DELETE FROM "questionnaires" WHERE "workspace_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaires_usage_key" ON "questionnaires"("usage");

DROP INDEX IF EXISTS "questionnaires_confluent_usage_key";

DROP INDEX IF EXISTS "questionnaires_workspace_usage_key";

ALTER TABLE "questionnaires" DROP CONSTRAINT IF EXISTS "questionnaires_usage_check";

ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_usage_check" CHECK ("usage" IN ('dossier'));

ALTER TABLE "questionnaires" DROP CONSTRAINT IF EXISTS "questionnaires_workspace_id_fkey";

DROP INDEX IF EXISTS "questionnaires_workspace_id_idx";

ALTER TABLE "questionnaires" DROP COLUMN IF EXISTS "workspace_id";
