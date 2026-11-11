-- Reverts migration 20261114000000_company_transfers (ROADMAP E05.08) before the application is
-- rolled back to E05.07. Companies, dossiers, answers and documents keep their rows, ids and owners.
-- Lost on the way back: the invitations and the trace of past transfers (`company_transfers`) and
-- their journal entries; the five values added to `audit_action` stay (PostgreSQL cannot remove
-- them; unused). A transferred company stays with the entrepreneur who accepted it.
--
-- A company still PREPARED by a conseiller would become, under E05.07, an ordinary company of that
-- conseiller — never offered to its entrepreneur any more. So the revert refuses while a company is
-- prepared, unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_held_companies = 'on';
-- (or the preparations are finished or deleted first). Run in one transaction
-- (psql --single-transaction), then remove the migration's row so it can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114000000_company_transfers';
-- Exercised by test/pg/company-transfers.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  held TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_held_companies', true), '') <> 'on' THEN
    SELECT "id" INTO held FROM "companies" WHERE "prepared_in_workspace_id" IS NOT NULL LIMIT 1;
    IF held IS NOT NULL THEN
      RAISE EXCEPTION 'company % is still prepared by a conseiller for an entrepreneur: finish or delete the preparations, or SET LOCAL confluent.accept_held_companies = ''on''', held;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" IN ('company_prepared', 'company_transfer_invited', 'company_transfer_accepted', 'company_transfer_declined', 'company_transfer_cancelled');

DROP TABLE IF EXISTS "company_transfers";

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_prepared_in_workspace_id_fkey";

DROP INDEX IF EXISTS "companies_prepared_in_workspace_id_idx";

ALTER TABLE "companies" DROP COLUMN IF EXISTS "prepared_in_workspace_id";
