-- ROADMAP E05.06: the company's document library. A document (`library_documents`) is a file name
-- answering one attachment field of the profile or none (code review R48), with a type and its
-- successive versions; each row of `documents` becomes one version of a document. Bringing an
-- earlier version back adds a version pointing at the same stored object (`restored_from_id`):
-- nothing is ever overwritten or deleted.
--
-- Backfill: one document per (company, field, name) of the existing versions, of type `other`, with
-- a deterministic id (a hash of that triple, shaped as a UUID v4) so that the migration gives the
-- same result each time it runs. Versions keep their rows, ids, numbers and stored objects. Versions
-- of a file without field could share a number (the old unique index cannot hold for a NULL field):
-- such numbers are renumbered explicitly, in their order. The field moves from the version to its
-- document (one truth); the version keeps copies of its document's company and name, held equal by
-- a composite foreign key.
--
-- Deployment resume: Prisma runs this file as one transaction. Each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, backfills of missing rows only, skipped once
-- `documents.field_id` is gone, constraints dropped before being added): any prefix of this file,
-- then the whole file, gives the same database (test/pg/document-library.pg-spec.ts). Undone by
-- prisma/checks/20261112200000_document_library.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'document_type_changed';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'document_version_restored';

-- 1. Documents of the library.
CREATE TABLE IF NOT EXISTS "library_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "field_id" TEXT,
    "filename" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_documents_pkey" PRIMARY KEY ("id")
);

-- Closed list, kept equal to DOCUMENT_TYPES in @confluent/shared.
ALTER TABLE "library_documents" DROP CONSTRAINT IF EXISTS "library_documents_type_check";

ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_type_check" CHECK ("type" IN (
  'business_plan', 'pitch_deck', 'financial_forecast', 'financial_statements', 'cap_table',
  'company_registration', 'articles_of_association', 'team_resumes', 'bank_details', 'other'
));

-- 2. One document per (company, field, name) of the existing versions, and each version attached
-- to its document.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "library_document_id" TEXT;

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "restored_from_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'documents' AND column_name = 'field_id'
  ) THEN
    INSERT INTO "library_documents" ("id", "company_id", "field_id", "filename", "type", "created_at", "updated_at")
    SELECT
      substr(g.h, 1, 8) || '-' || substr(g.h, 9, 4) || '-4' || substr(g.h, 14, 3) || '-8'
        || substr(g.h, 18, 3) || '-' || substr(g.h, 21, 12),
      g."company_id", g."field_id", g."filename", 'other', g.first_at, g.last_at
    FROM (
      SELECT
        md5('library-document:' || d."company_id" || ':' || coalesce(d."field_id", '') || ':' || d."filename") AS h,
        d."company_id", d."field_id", d."filename",
        min(d."created_at") AS first_at, max(d."created_at") AS last_at
      FROM "documents" d
      GROUP BY d."company_id", d."field_id", d."filename"
    ) g
    WHERE NOT EXISTS (
      SELECT 1 FROM "library_documents" l
      WHERE l."company_id" = g."company_id"
        AND l."field_id" IS NOT DISTINCT FROM g."field_id"
        AND l."filename" = g."filename"
    );

    UPDATE "documents" d
    SET "library_document_id" = l."id"
    FROM "library_documents" l
    WHERE d."library_document_id" IS NULL
      AND l."company_id" = d."company_id"
      AND l."field_id" IS NOT DISTINCT FROM d."field_id"
      AND l."filename" = d."filename";
  END IF;
END $$;

-- 3. Version numbers unique within a document: duplicates renumbered in their order.
UPDATE "documents" d
SET "version" = r.n
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "library_document_id" ORDER BY "version", "created_at", "id"
  )::int AS n
  FROM "documents"
  WHERE "library_document_id" IN (
    SELECT "library_document_id" FROM "documents"
    GROUP BY "library_document_id", "version" HAVING count(*) > 1
  )
) r
WHERE d."id" = r."id" AND d."version" <> r.n;

ALTER TABLE "documents" ALTER COLUMN "library_document_id" SET NOT NULL;

-- 4. Keys and indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "library_documents_company_id_field_id_filename_key" ON "library_documents"("company_id", "field_id", "filename");

CREATE UNIQUE INDEX IF NOT EXISTS "library_documents_id_company_id_filename_key" ON "library_documents"("id", "company_id", "filename");

CREATE INDEX IF NOT EXISTS "library_documents_field_id_idx" ON "library_documents"("field_id");

CREATE UNIQUE INDEX IF NOT EXISTS "documents_library_document_id_version_key" ON "documents"("library_document_id", "version");

CREATE INDEX IF NOT EXISTS "documents_restored_from_id_idx" ON "documents"("restored_from_id");

ALTER TABLE "library_documents" DROP CONSTRAINT IF EXISTS "library_documents_company_id_fkey";

ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "library_documents" DROP CONSTRAINT IF EXISTS "library_documents_field_id_fkey";

ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "questionnaire_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_library_document_id_company_id_filename_fkey";

ALTER TABLE "documents" ADD CONSTRAINT "documents_library_document_id_company_id_filename_fkey" FOREIGN KEY ("library_document_id", "company_id", "filename") REFERENCES "library_documents"("id", "company_id", "filename") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_restored_from_id_fkey";

ALTER TABLE "documents" ADD CONSTRAINT "documents_restored_from_id_fkey" FOREIGN KEY ("restored_from_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. The field is now the document's.
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_field_id_fkey";

DROP INDEX IF EXISTS "documents_company_id_field_id_filename_version_key";

DROP INDEX IF EXISTS "documents_field_id_idx";

ALTER TABLE "documents" DROP COLUMN IF EXISTS "field_id";
