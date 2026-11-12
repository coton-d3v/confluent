-- ROADMAP E09.03: a workspace's managers may hide a card from their own public page (never edit it),
-- reversibly, journaled; its owner reads it « masquée par la structure » and keeps the right to
-- withdraw it. Rules: @confluent/shared `showcase-card.schema.ts`; what the public reads of each
-- column: `SHOWCASE_CARD_COLUMN_AUDIENCE` (src/modules/showcase-cards/showcase-card-views.ts).
--
--  * `showcase_cards.hidden_at`: when one of the workspace's managers hid the card (null: not
--    hidden), `hidden_by_id`: who (set to null when the account is deleted, the card stays hidden).
--    Kept through a withdrawal and a new consent: lifting it is the managers' decision.
--  * `audit_action` gains `showcase_card_hidden` and `showcase_card_unhidden`.
--
-- CHECK: who hid it only while hidden.
--
-- Backfill: none — no card was ever hidden (the columns start null: every card stays as it is).
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix
-- of this file, then the whole file, gives the same database
-- (test/pg/showcase-card-moderation.pg-spec.ts). Undone by
-- prisma/checks/20261209000000_showcase_card_moderation.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'showcase_card_hidden';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'showcase_card_unhidden';

ALTER TABLE "showcase_cards" ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMP(3);

ALTER TABLE "showcase_cards" ADD COLUMN IF NOT EXISTS "hidden_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "showcase_cards_hidden_by_id_idx" ON "showcase_cards"("hidden_by_id");

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_hidden_by_id_fkey";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_hidden_check";

ALTER TABLE "showcase_cards" ADD CONSTRAINT "showcase_cards_hidden_check" CHECK (
  "hidden_by_id" IS NULL OR "hidden_at" IS NOT NULL
);
