-- ROADMAP E06.02, decision D04 « Sources du plan et promesses » (proposal, still to be confirmed):
-- each workspace keeps its own list of the categories a financing plan is split into. Closed list
-- of families, default categories and limits: @confluent/shared `funding-source.schema.ts`.
--
--  * `funding_source_categories`: one row per category of a workspace — `key` (stable, unique in
--    the workspace) and `family` (closed list) fixed at creation; `label` (unique in the
--    workspace), `position` and `active` configured by its managers. Deactivated, never deleted;
--    removed with its workspace only.
--
-- Backfill, explicit: every existing workspace gets D04's six default categories, in D04's order,
-- active, with an id derived from the workspace and the key (the same on every run). A workspace
-- created afterwards gets them from the API, in the transaction that creates it.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill
-- skipping the categories already there), so any prefix of this file, then the whole file, gives the
-- same database (test/pg/funding-source-categories.pg-spec.ts). Undone by
-- prisma/checks/20261118000000_funding_source_categories.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'funding_source_categories_updated';

CREATE TABLE IF NOT EXISTS "funding_source_categories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_source_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "funding_source_categories_workspace_id_key_key" ON "funding_source_categories"("workspace_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "funding_source_categories_workspace_id_label_key" ON "funding_source_categories"("workspace_id", "label");

ALTER TABLE "funding_source_categories" DROP CONSTRAINT IF EXISTS "funding_source_categories_workspace_id_fkey";

ALTER TABLE "funding_source_categories" ADD CONSTRAINT "funding_source_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed family; key as the API derives it; label on one line, trimmed and bounded.
ALTER TABLE "funding_source_categories" DROP CONSTRAINT IF EXISTS "funding_source_categories_check";

ALTER TABLE "funding_source_categories" ADD CONSTRAINT "funding_source_categories_check" CHECK (
  "family" IN ('aides_publiques', 'pret_honneur', 'pret_bancaire', 'business_angels_love_money', 'fonds_investissement', 'fonds_propres', 'autre')
  AND "key" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
  AND char_length("key") <= 60
  AND char_length("label") BETWEEN 1 AND 80
  AND "label" = btrim("label")
  AND "label" !~ '[[:cntrl:]]'
  AND "position" >= 0
);

-- Backfill: D04's default categories for every existing workspace. The id is a version-4 shaped
-- UUID (as the API's ids, which the contracts validate) drawn from md5(workspace, key).
INSERT INTO "funding_source_categories" ("id", "workspace_id", "key", "label", "family", "position", "active", "updated_at")
SELECT
  substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12),
  "workspace_id", "key", "label", "family", "position", true, CURRENT_TIMESTAMP
FROM (
  SELECT md5('funding-source-category:' || w."id" || ':' || d."key") AS h, w."id" AS "workspace_id", d.*
  FROM "workspaces" w
  CROSS JOIN (VALUES
    ('bpifrance', 'Bpifrance', 'aides_publiques', 0),
    ('pret_honneur', 'Prêt d’honneur', 'pret_honneur', 1),
    ('pret_bancaire', 'Prêt bancaire', 'pret_bancaire', 2),
    ('business_angels_love_money', 'Business angels / love money', 'business_angels_love_money', 3),
    ('fonds_investissement', 'Fonds d’investissement', 'fonds_investissement', 4),
    ('fonds_propres', 'Fonds propres', 'fonds_propres', 5)
  ) AS d("key", "label", "family", "position")
) AS backfill
ON CONFLICT DO NOTHING;
