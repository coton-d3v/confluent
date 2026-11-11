-- Reverts migration 20261112200000_document_library (ROADMAP E05.06) before the application is
-- rolled back to E05.05, where each row of `documents` is a version identified by its company,
-- field and name. Every version keeps its row, id, number and stored object, and gets its
-- document's field back. Lost on the way back: the documents' types, which version brought back
-- which (a restored version stays a version of its own, sharing its stored object), and the journal
-- entries of type changes and restorations, which the E05.05 application cannot read. The two values
-- added to `audit_action` stay (PostgreSQL cannot remove them; unused). Run in one transaction
-- (psql --single-transaction), then remove the migration's row so it can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112200000_document_library';
-- Exercised by test/pg/document-library.pg-spec.ts (revert, then apply the migration again).

ALTER TABLE "documents" ADD COLUMN "field_id" TEXT;

UPDATE "documents" d SET "field_id" = l."field_id"
FROM "library_documents" l
WHERE l."id" = d."library_document_id";

CREATE INDEX "documents_field_id_idx" ON "documents"("field_id");

CREATE UNIQUE INDEX "documents_company_id_field_id_filename_version_key" ON "documents"("company_id", "field_id", "filename", "version");

ALTER TABLE "documents" ADD CONSTRAINT "documents_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "questionnaire_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT "documents_restored_from_id_fkey";

ALTER TABLE "documents" DROP CONSTRAINT "documents_library_document_id_company_id_filename_fkey";

DROP INDEX "documents_restored_from_id_idx";

DROP INDEX "documents_library_document_id_version_key";

ALTER TABLE "documents" DROP COLUMN "restored_from_id";

ALTER TABLE "documents" DROP COLUMN "library_document_id";

DROP TABLE "library_documents";

DELETE FROM "audit_log" WHERE "action_type" IN ('document_type_changed', 'document_version_restored');
