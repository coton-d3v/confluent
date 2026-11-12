-- Reverts migration 20261128000000_position_disclosures (ROADMAP E07.07) before the application is
-- rolled back to E07.06. Lost on the way back: every investor's consent to show a structure their
-- position on a request, and the journal entries of these consents and their withdrawals; the
-- values added to `audit_action` stay (PostgreSQL cannot remove them; unused). The earlier
-- application shows no position to any structure: nothing it reads changes. To be run FIRST, before
-- the reverts of E07.06 and of the earlier migrations.
--
-- Without any consent nor journal entry, nothing is lost. One would be — an investor's explicit
-- choice, which they would have to give again —, so the revert refuses unless the operator accepts
-- it explicitly for this transaction:
--   SET LOCAL confluent.accept_position_disclosures_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261128000000_position_disclosures';
-- Exercised by test/pg/positions.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_position_disclosures_loss', true), '') <> 'on' THEN
    IF to_regclass('investor_position_disclosures') IS NOT NULL THEN
      EXECUTE 'SELECT "dossier_id" FROM "investor_position_disclosures" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'consents to show positions to structures exist (request %): they would be lost; SET LOCAL confluent.accept_position_disclosures_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('investor_position_disclosed', 'investor_position_disclosure_withdrawn') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'consents to show positions to structures are journaled (entry %): they would be lost; SET LOCAL confluent.accept_position_disclosures_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('investor_position_disclosed', 'investor_position_disclosure_withdrawn');

DROP TABLE IF EXISTS "investor_position_disclosures";
