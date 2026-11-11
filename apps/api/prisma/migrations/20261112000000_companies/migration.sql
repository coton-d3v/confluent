-- ROADMAP E05.04: the company an entrepreneur presents, owner of the common profile (and, from
-- E05.06, of the document library), and its financing dossiers (`dossiers.company_id`).
--
-- Backfill: every existing dossier was at once the company and the request, so each one gets its
-- own company (1:1), owned by the dossier's owner and named after the dossier. Answers, versions,
-- documents, shares and slugs are left untouched: moving the profile and the documents onto the
-- company is E05.05. The backfill only fills what is missing, and the whole change is undone by
-- prisma/checks/20261112000000_companies.down.sql (no data is lost: a company holds nothing but a
-- name copied from its dossier).
--
-- `dossiers.user_id` stays and is now the company's owner: the (company_id, user_id) foreign key
-- forbids a dossier whose owner differs from its company's, and a change of owner (E05.08)
-- cascades to the dossiers. NO ACTION (checked at the end of the statement): a company with
-- dossiers cannot be deleted, while deleting an account still removes both.

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id"),
    -- Same format as the API writes (@confluent/shared company.schema.ts).
    CONSTRAINT "companies_name_check"
      CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 200)
);

CREATE INDEX "companies_owner_id_idx" ON "companies"("owner_id");

CREATE UNIQUE INDEX "companies_id_owner_id_key" ON "companies"("id", "owner_id");

ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill, one company per existing dossier.
ALTER TABLE "dossiers" ADD COLUMN "company_id" TEXT;

UPDATE "dossiers" SET "company_id" = gen_random_uuid()::text WHERE "company_id" IS NULL;

-- A name the API never wrote (blank, too long, padded) is brought to the company's format.
INSERT INTO "companies" ("id", "owner_id", "name", "created_at", "updated_at")
SELECT d."company_id",
       d."user_id",
       COALESCE(NULLIF(btrim(left(btrim(d."name"), 200)), ''), 'Entreprise sans nom'),
       d."created_at",
       CURRENT_TIMESTAMP
FROM "dossiers" d
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = d."company_id");

ALTER TABLE "dossiers" ALTER COLUMN "company_id" SET NOT NULL;

CREATE INDEX "dossiers_company_id_idx" ON "dossiers"("company_id");

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_company_id_user_id_fkey" FOREIGN KEY ("company_id", "user_id") REFERENCES "companies"("id", "owner_id") ON DELETE NO ACTION ON UPDATE CASCADE;
