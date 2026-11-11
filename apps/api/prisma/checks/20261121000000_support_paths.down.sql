-- Reverts migration 20261121000000_support_paths (ROADMAP E06.06) before the application is rolled
-- back to E06.05. Lost on the way back: the support path of every workspace, the validations of
-- every candidature with their history, and the journal entries of their changes; the values added
-- to `audit_action` stay (PostgreSQL cannot remove them; unused). To be run FIRST, before the
-- reverts of E06.05, E06.03 and E06.02: the validations' foreign key uses E06.03's unique index on
-- `candidatures (id, workspace_id)`.
--
-- A workspace that kept the default steps, without any validation, loses nothing a new run of the
-- migration does not give back. Validations (even withdrawn ones: their history) and steps a
-- workspace configured — renamed, explained, reordered, deactivated or added — would be lost, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_support_paths_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261121000000_support_paths';
-- Exercised by test/pg/support-paths.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF to_regclass('support_steps') IS NOT NULL
     AND coalesce(current_setting('confluent.accept_support_paths_loss', true), '') <> 'on' THEN
    IF to_regclass('candidature_step_validations') IS NOT NULL THEN
      EXECUTE 'SELECT "candidature_id" FROM "candidature_step_validations" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'step validations exist (candidature %): they would be lost; SET LOCAL confluent.accept_support_paths_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    EXECUTE $q$
      SELECT s."workspace_id"
      FROM "support_steps" s
      LEFT JOIN (VALUES
        ('diagnostic', 'Diagnostic', 'Un premier échange avec votre conseiller pour faire le point sur le projet, l’équipe et les besoins de financement, et convenir des étapes suivantes.', 0),
        ('business_plan', 'Business plan', 'Le business plan et le prévisionnel financier sont rédigés, puis relus avec votre conseiller.', 1),
        ('pitch', 'Pitch', 'La présentation du projet est prête et a été répétée avec votre conseiller avant d’être présentée aux financeurs.', 2)
      ) AS d("key", "label", "explanation", "position")
        ON d."key" = s."key" AND d."label" = s."label" AND d."explanation" = s."explanation" AND d."position" = s."position"
      WHERE d."key" IS NULL OR NOT s."active"
      LIMIT 1
    $q$ INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'configured support steps exist (workspace %): they would be lost; SET LOCAL confluent.accept_support_paths_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" IN ('support_steps_updated', 'candidature_support_step_updated');

DROP TABLE IF EXISTS "candidature_step_validation_changes";

DROP TABLE IF EXISTS "candidature_step_validations";

DROP TABLE IF EXISTS "support_steps";
