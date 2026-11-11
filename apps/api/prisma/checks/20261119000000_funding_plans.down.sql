-- Reverts migration 20261119000000_funding_plans (ROADMAP E06.03) before the application is rolled
-- back to E06.02. Lost on the way back: every line of every financing plan and the journal entries
-- of their changes; the value added to `audit_action` stays (PostgreSQL cannot remove it; unused).
--
-- A plan is data entered by entrepreneurs and conseillers that no earlier version can hold, so the
-- revert refuses while a line exists unless the operator accepts the loss explicitly for this
-- transaction:
--   SET LOCAL confluent.accept_funding_plans_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119000000_funding_plans';
-- Exercised by test/pg/funding-plans.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF to_regclass('funding_plan_lines') IS NOT NULL
     AND coalesce(current_setting('confluent.accept_funding_plans_loss', true), '') <> 'on' THEN
    EXECUTE 'SELECT "candidature_id" FROM "funding_plan_lines" LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'financing plans exist (candidature %): they would be lost; SET LOCAL confluent.accept_funding_plans_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" = 'funding_plan_updated';

DROP TABLE IF EXISTS "funding_plan_lines";

DROP INDEX IF EXISTS "funding_source_categories_id_workspace_id_key";

DROP INDEX IF EXISTS "candidatures_id_workspace_id_key";
