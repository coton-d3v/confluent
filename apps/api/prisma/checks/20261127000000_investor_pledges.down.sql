-- Reverts migration 20261127000000_investor_pledges (ROADMAP E07.06) before the application is
-- rolled back to E07.05. Lost on the way back: every pledge — intention, amount, comment and each
-- investor's choices to show their name and amount — and the journal entries of the pledges and
-- withdrawals; the values added to `audit_action` stay (PostgreSQL cannot remove them; unused). The
-- earlier application has no pledge: nothing it reads changes. To be run FIRST, before the reverts of
-- E07.05 and of the earlier migrations.
--
-- Without any pledge nor journal entry, nothing is lost. One would be — a pledge is what the owner
-- counts on to close a round —, so the revert refuses unless the operator accepts it explicitly for
-- this transaction:
--   SET LOCAL confluent.accept_investor_pledges_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127000000_investor_pledges';
-- Exercised by test/pg/pledges.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_investor_pledges_loss', true), '') <> 'on' THEN
    IF to_regclass('investor_pledges') IS NOT NULL THEN
      EXECUTE 'SELECT "dossier_id" FROM "investor_pledges" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'pledges exist (request %): they would be lost; SET LOCAL confluent.accept_investor_pledges_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('investor_pledge_set', 'investor_pledge_withdrawn') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'pledges are journaled (entry %): they would be lost; SET LOCAL confluent.accept_investor_pledges_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('investor_pledge_set', 'investor_pledge_withdrawn');

DROP TABLE IF EXISTS "investor_pledges";

DROP SEQUENCE IF EXISTS "investor_pledge_revisions";
