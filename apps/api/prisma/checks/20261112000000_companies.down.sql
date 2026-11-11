-- Reverts migration 20261112000000_companies (ROADMAP E05.04) before the application is rolled back
-- to a version without companies. Nothing is lost: a company only holds a name copied from its
-- dossier, and dossiers keep their owner. Then remove the migration's row so it can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112000000_companies';
-- Exercised by test/pg/companies.pg-spec.ts (revert, then apply the migration again).

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_company_id_user_id_fkey";

DROP INDEX "dossiers_company_id_idx";

ALTER TABLE "dossiers" DROP COLUMN "company_id";

DROP TABLE "companies";
