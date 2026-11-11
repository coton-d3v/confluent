-- ROADMAP E05.07: several financing requests per company. A request is a dossier (`dossiers`, same
-- table, same ids, same slugs and share tokens), now with its own presentation — title (`name`),
-- summary, objective, description, amount in whole euros, types of financing — a publication status
-- and the selection of the company's library documents it presents (`dossier_documents`): each
-- selected document follows its latest version (`pinned_version_id` NULL) or is pinned to one of its
-- versions. Only selected documents, at that version, reach the recipients of the dossier's shares.
--
-- What changes from E05.05/E05.06: a company may now have several dossiers. The guard of migration
-- 20261112100000_company_profile ("one dossier per company") ran before this one and never runs
-- again; its revert script refuses to go back while a company has several dossiers, which is the
-- intended limit of a rollback below E05.06.
--
-- Backfill, explicit:
--  * presentation empty and publication `draft` for every existing dossier (a draft opens and closes
--    no share: what its recipients saw stays visible);
--  * every existing dossier selects every document of its company's library, following its latest
--    version, so that no share recipient loses a document they could read before (one dossier per
--    company until now: the library was the dossier's). Deterministic ids (a hash of the pair,
--    shaped as a UUID v4) and dates (the later of the dossier's and the document's creation): the
--    migration gives the same database each time it runs.
--
-- Deployment resume: Prisma runs this file as one transaction. Each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill of
-- missing pairs only): any prefix of this file, then the whole file, gives the same database
-- (test/pg/financing-requests.pg-spec.ts). Undone by
-- prisma/checks/20261113000000_financing_requests.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_published';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_unpublished';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_document_selected';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'dossier_document_unselected';

-- 1. Presentation and publication of each request.
ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "summary" TEXT;

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "objective" TEXT;

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "description" TEXT;

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "amount_eur" INTEGER;

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "financing_types" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "publication_status" TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE "dossiers" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);

-- Existing dossiers: no presentation yet, a draft (the column defaults); no list left NULL.
UPDATE "dossiers" SET "financing_types" = ARRAY[]::TEXT[] WHERE "financing_types" IS NULL;

-- Formats and closed values, repeated from @confluent/shared (financing.schema.ts).
ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_summary_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_summary_check"
  CHECK ("summary" IS NULL OR char_length(btrim("summary")) BETWEEN 1 AND 300);

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_objective_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_objective_check"
  CHECK ("objective" IS NULL OR char_length(btrim("objective")) BETWEEN 1 AND 1000);

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_description_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_description_check"
  CHECK ("description" IS NULL OR char_length(btrim("description")) BETWEEN 1 AND 5000);

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_amount_eur_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_amount_eur_check"
  CHECK ("amount_eur" IS NULL OR "amount_eur" BETWEEN 1 AND 1000000000);

-- Closed list, kept equal to FINANCING_TYPES in @confluent/shared; never NULL.
ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_financing_types_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_financing_types_check" CHECK (
  "financing_types" IS NOT NULL
  AND array_position("financing_types", NULL) IS NULL
  AND cardinality("financing_types") <= 8
  AND "financing_types" <@ ARRAY[
    'equity', 'convertible', 'bank_loan', 'honor_loan', 'public_funding', 'grant', 'crowdfunding',
    'other'
  ]::TEXT[]
);

-- `published_at` is set exactly while the request is published.
ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_publication_status_check";

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_publication_status_check" CHECK (
  "publication_status" IN ('draft', 'published')
  AND ("publication_status" = 'published') = ("published_at" IS NOT NULL)
);

-- 2. The documents each request selects.
CREATE TABLE IF NOT EXISTS "dossier_documents" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "library_document_id" TEXT NOT NULL,
    "pinned_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossier_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dossier_documents_library_document_id_idx" ON "dossier_documents"("library_document_id");

CREATE INDEX IF NOT EXISTS "dossier_documents_pinned_version_id_idx" ON "dossier_documents"("pinned_version_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dossier_documents_dossier_id_library_document_id_key" ON "dossier_documents"("dossier_id", "library_document_id");

-- Targets of the composite foreign keys: the dossier, the document and the pinned version belong to
-- the same company and document.
CREATE UNIQUE INDEX IF NOT EXISTS "documents_id_library_document_id_key" ON "documents"("id", "library_document_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dossiers_id_company_id_key" ON "dossiers"("id", "company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "library_documents_id_company_id_key" ON "library_documents"("id", "company_id");

ALTER TABLE "dossier_documents" DROP CONSTRAINT IF EXISTS "dossier_documents_dossier_id_company_id_fkey";

ALTER TABLE "dossier_documents" ADD CONSTRAINT "dossier_documents_dossier_id_company_id_fkey" FOREIGN KEY ("dossier_id", "company_id") REFERENCES "dossiers"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dossier_documents" DROP CONSTRAINT IF EXISTS "dossier_documents_library_document_id_company_id_fkey";

ALTER TABLE "dossier_documents" ADD CONSTRAINT "dossier_documents_library_document_id_company_id_fkey" FOREIGN KEY ("library_document_id", "company_id") REFERENCES "library_documents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dossier_documents" DROP CONSTRAINT IF EXISTS "dossier_documents_pinned_version_id_library_document_id_fkey";

ALTER TABLE "dossier_documents" ADD CONSTRAINT "dossier_documents_pinned_version_id_library_document_id_fkey" FOREIGN KEY ("pinned_version_id", "library_document_id") REFERENCES "documents"("id", "library_document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Existing dossiers select their company's whole library, following each document's latest
-- version (a share keeps every document it showed).
INSERT INTO "dossier_documents" ("id", "dossier_id", "company_id", "library_document_id", "pinned_version_id", "created_at", "updated_at")
SELECT
  substr(p.h, 1, 8) || '-' || substr(p.h, 9, 4) || '-4' || substr(p.h, 14, 3) || '-8'
    || substr(p.h, 18, 3) || '-' || substr(p.h, 21, 12),
  p."dossier_id", p."company_id", p."library_document_id", NULL, p.at, p.at
FROM (
  SELECT
    md5('dossier-document:' || d."id" || ':' || l."id") AS h,
    d."id" AS "dossier_id", d."company_id", l."id" AS "library_document_id",
    greatest(d."created_at", l."created_at") AS at
  FROM "dossiers" d
  JOIN "library_documents" l ON l."company_id" = d."company_id"
) p
ON CONFLICT ("dossier_id", "library_document_id") DO NOTHING;
