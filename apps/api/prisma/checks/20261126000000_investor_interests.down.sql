-- Reverts migration 20261126000000_investor_interests (ROADMAP E07.05) before the application is
-- rolled back to E07.04. Lost on the way back: every mark of interest — with each investor's choice to
-- show their name — and the journal entries of the marks and withdrawals; the values added to
-- `audit_action` stay (PostgreSQL cannot remove them; unused). The earlier application has no mark:
-- nothing it reads changes. To be run FIRST, before the reverts of E07.03 and of the earlier
-- migrations.
--
-- Without any mark nor journal entry, nothing is lost. One would be — an investor's interest is what
-- the owner reads to follow up —, so the revert refuses unless the operator accepts it explicitly for
-- this transaction:
--   SET LOCAL confluent.accept_investor_interests_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126000000_investor_interests';
-- Exercised by test/pg/interests.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_investor_interests_loss', true), '') <> 'on' THEN
    IF to_regclass('investor_interests') IS NOT NULL THEN
      EXECUTE 'SELECT "dossier_id" FROM "investor_interests" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'marks of interest exist (request %): they would be lost; SET LOCAL confluent.accept_investor_interests_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('investor_interest_marked', 'investor_interest_withdrawn') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'marks of interest are journaled (entry %): they would be lost; SET LOCAL confluent.accept_investor_interests_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('investor_interest_marked', 'investor_interest_withdrawn');

DROP TABLE IF EXISTS "investor_interests";
