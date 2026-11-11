-- Reverts migration 20261125000000_opportunity_views (ROADMAP E07.03) before the application is
-- rolled back to E07.02. Lost on the way back: the journal entries of the investors' readings of
-- their opportunities (the earlier application cannot read them); the value added to `audit_action`
-- stays (PostgreSQL cannot remove it; unused). To be run FIRST, before the reverts of E07.02 and of
-- the earlier migrations.
--
-- Without any reading journaled, nothing is lost. An entry would be, so the revert refuses unless the
-- operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_opportunity_views_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261125000000_opportunity_views';
-- Exercised by test/pg/opportunities.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_opportunity_views_loss', true), '') <> 'on' THEN
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text = 'opportunity_viewed' LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'opportunity readings are journaled (entry %): they would be lost; SET LOCAL confluent.accept_opportunity_views_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type"::text = 'opportunity_viewed';
