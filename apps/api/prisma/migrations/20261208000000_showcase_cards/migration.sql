-- ROADMAP E09.02: the anonymous cards of financing requests on a workspace's public page (`/w/<slug>`,
-- E09.01), with the explicit consent of each request's owner. Rules: @confluent/shared
-- `showcase-card.schema.ts`; what the public reads of each column: `SHOWCASE_CARD_COLUMN_AUDIENCE`
-- (src/modules/showcase-cards/showcase-card-views.ts).
--
--  * `showcase_cards`: one row per candidature (one request presented to one workspace, E05.09),
--    unique: the pseudonym the owner chose (required — a request without one is never shown), the
--    region they chose or none, the latest consent (`consented_at`, `consented_by_id`), and once
--    withdrawn its date, who withdrew it and why (`owner` | `archived`); `version` counts its changes,
--    never reused (the row stays: a new consent writes on it). The foreign key carries
--    `workspace_id` (the candidatures' target is E06.03's unique index): a card never shows on another
--    workspace's page. Removed with its candidature (that is, with its request); an account deleted
--    leaves it without consenter or withdrawer.
--  * `audit_action` gains `showcase_card_published` (first consent, new consent, change of pseudonym
--    or region) and `showcase_card_withdrawn` (by the owner, or with the archiving of the request).
--
-- CHECK: pseudonym one trimmed line of 2 to 60 characters, without control characters, double
-- spaces, markup, address or link; region among the closed list (or none); withdrawal coherent;
-- version ≥ 1.
--
-- Backfill: none — no owner ever consented to a card (neither publishing a request, presenting it,
-- its pool publication nor a share is such a consent), so the table starts empty and nothing else is
-- touched.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix
-- of this file, then the whole file, gives the same database (test/pg/showcase-cards.pg-spec.ts).
-- Undone by prisma/checks/20261208000000_showcase_cards.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'showcase_card_published';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'showcase_card_withdrawn';

CREATE TABLE IF NOT EXISTS "showcase_cards" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "region" TEXT,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "consented_by_id" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by_id" TEXT,
    "withdrawal_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "showcase_cards_candidature_id_key" ON "showcase_cards"("candidature_id");

CREATE INDEX IF NOT EXISTS "showcase_cards_workspace_id_withdrawn_at_idx" ON "showcase_cards"("workspace_id", "withdrawn_at");

CREATE INDEX IF NOT EXISTS "showcase_cards_consented_by_id_idx" ON "showcase_cards"("consented_by_id");

CREATE INDEX IF NOT EXISTS "showcase_cards_withdrawn_by_id_idx" ON "showcase_cards"("withdrawn_by_id");

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_candidature_id_workspace_id_fkey";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_consented_by_id_fkey";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_consented_by_id_fkey" FOREIGN KEY ("consented_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_withdrawn_by_id_fkey";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_withdrawn_by_id_fkey" FOREIGN KEY ("withdrawn_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One line of plain text (`pseudonymSchema`): never an address, a link or markup.
ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_pseudonym_check";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_pseudonym_check" CHECK (
  char_length("pseudonym") BETWEEN 2 AND 60
  AND "pseudonym" = btrim("pseudonym")
  AND "pseudonym" !~ '[[:cntrl:]]'
  AND strpos("pseudonym", '  ') = 0
  AND "pseudonym" !~ '<[A-Za-z!/?]'
  AND "pseudonym" !~* '@|://|www\.'
);

-- @confluent/shared `SHOWCASE_REGIONS`.
ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_region_check";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_region_check" CHECK (
  "region" IS NULL OR "region" IN (
    'auvergne-rhone-alpes', 'bourgogne-franche-comte', 'bretagne', 'centre-val-de-loire', 'corse',
    'grand-est', 'hauts-de-france', 'ile-de-france', 'normandie', 'nouvelle-aquitaine', 'occitanie',
    'pays-de-la-loire', 'provence-alpes-cote-d-azur', 'guadeloupe', 'guyane', 'la-reunion',
    'martinique', 'mayotte'
  )
);

-- Withdrawn exactly when a reason is given, among `owner` and `archived`; who withdrew it only then;
-- never before the consent it ends.
ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_withdrawal_check";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_withdrawal_check" CHECK (
  ("withdrawn_at" IS NULL) = ("withdrawal_reason" IS NULL)
  AND ("withdrawal_reason" IS NULL OR "withdrawal_reason" IN ('owner', 'archived'))
  AND ("withdrawn_by_id" IS NULL OR "withdrawn_at" IS NOT NULL)
  AND ("withdrawn_at" IS NULL OR "withdrawn_at" >= "consented_at")
);

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_version_check";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_version_check" CHECK ("version" >= 1);
