-- Reverts migration 20261209000000_showcase_card_moderation (ROADMAP E09.03) before the application
-- is rolled back to E09.02. Lost on the way back: which cards the workspaces' managers hid, by whom
-- and when, and the journal entries of their hidings and restorations; the values added to
-- `audit_action` stay (PostgreSQL cannot remove them; unused). The earlier application would show a
-- hidden card again on its workspace's page: that is why a card hidden now refuses the revert. To be
-- run FIRST, before the revert of E09.02 (20261208000000_showcase_cards), which drops the table.
--
-- Without any card hidden nor journal entry, nothing is lost. One would be — a hidden card shown
-- again, or the trace of a moderation —, so the revert refuses unless the operator accepts it
-- explicitly for this transaction:
--   SET LOCAL confluent.accept_showcase_card_moderation_loss = 'on';
-- (then, to keep a card hidden off the page, its owner or an operator withdraws it first). Run in one
-- transaction (psql --single-transaction), then remove the migration's row so it can be applied
-- again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261209000000_showcase_card_moderation';
-- Exercised by test/pg/showcase-card-moderation.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_showcase_card_moderation_loss', true), '') <> 'on' THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'showcase_cards'
        AND column_name = 'hidden_at'
    ) THEN
      EXECUTE 'SELECT "candidature_id" FROM "showcase_cards" WHERE "hidden_at" IS NOT NULL LIMIT 1'
        INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'a showcase card is hidden by its workspace (candidature %): it would be shown again; SET LOCAL confluent.accept_showcase_card_moderation_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('showcase_card_hidden', 'showcase_card_unhidden') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'showcase cards were moderated (journal entry %): the trace would be lost; SET LOCAL confluent.accept_showcase_card_moderation_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('showcase_card_hidden', 'showcase_card_unhidden');

ALTER TABLE IF EXISTS "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_hidden_check";

ALTER TABLE IF EXISTS "showcase_cards" DROP CONSTRAINT IF EXISTS "showcase_cards_hidden_by_id_fkey";

DROP INDEX IF EXISTS "showcase_cards_hidden_by_id_idx";

ALTER TABLE IF EXISTS "showcase_cards" DROP COLUMN IF EXISTS "hidden_by_id";

ALTER TABLE IF EXISTS "showcase_cards" DROP COLUMN IF EXISTS "hidden_at";
