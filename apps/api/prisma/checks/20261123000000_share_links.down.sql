-- Reverts migration 20261123000000_share_links (ROADMAP E07.01) before the application is rolled
-- back to E06.09. Lost on the way back: the CHECK on `share_links.access_level` and the journal
-- entries of level changes (the earlier application cannot read them); the value added to
-- `audit_action` stays (PostgreSQL cannot remove it; unused). Levels written `public` by the
-- backfill stay `public`, which the earlier application reads the same. To be run FIRST, before the
-- reverts of earlier migrations.
--
-- Without any level change journaled, nothing is lost. An entry would be, so the revert refuses
-- unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_share_level_journal_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123000000_share_links';
-- Exercised by test/pg/share-links.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_share_level_journal_loss', true), '') <> 'on' THEN
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text = 'share_link_level_changed' LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'share level changes are journaled (entry %): they would be lost; SET LOCAL confluent.accept_share_level_journal_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type"::text = 'share_link_level_changed';

ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_access_level_check";
