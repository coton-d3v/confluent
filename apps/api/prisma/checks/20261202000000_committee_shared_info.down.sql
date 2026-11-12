-- Reverts migration 20261202000000_committee_shared_info (ROADMAP E08.02) before the application is
-- rolled back to E08.01. Lost on the way back: the information each committee shares with its
-- candidates and investors (`shared_info`); the internal notes, the committees and their journal
-- stay (a `committee_updated` entry may still name the field `sharedInfo`: it never held its text).
-- Nothing references the column: it can be run first, before the reverts of earlier migrations.
--
-- Without any shared information, nothing is lost. Some would be — text its managers would have to
-- type again —, so the revert refuses unless the operator accepts it explicitly for this
-- transaction:
--   SET LOCAL confluent.accept_committee_shared_info_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261202000000_committee_shared_info';
-- Exercised by test/pg/committee-shared-info.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_committee_shared_info_loss', true), '') <> 'on'
     AND to_regclass('committees') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'committees'
                   AND column_name = 'shared_info') THEN
    EXECUTE 'SELECT "id" FROM "committees" WHERE "shared_info" IS NOT NULL LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'committees share information (committee %): it would be lost; SET LOCAL confluent.accept_committee_shared_info_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

ALTER TABLE IF EXISTS "committees" DROP CONSTRAINT IF EXISTS "committees_shared_info_check";

ALTER TABLE IF EXISTS "committees" DROP COLUMN IF EXISTS "shared_info";
