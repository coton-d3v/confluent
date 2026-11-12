-- Reverts migration 20261208000000_showcase_cards (ROADMAP E09.02) before the application is rolled
-- back to E09.01. Lost on the way back: every card consent — active or withdrawn, with its pseudonym,
-- region, dates and authors — and the journal entries of their consents and withdrawals; the values
-- added to `audit_action` stay (PostgreSQL cannot remove them; unused). The earlier application shows
-- no card: nothing it reads changes. To be run FIRST, before the reverts of E09.01 and of the earlier
-- migrations — the cards' foreign key uses E06.03's unique index on `candidatures (id, workspace_id)`.
--
-- Without any card nor journal entry, nothing is lost. One would be — a consent is a trace the owner
-- may need —, so the revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_showcase_cards_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261208000000_showcase_cards';
-- Exercised by test/pg/showcase-cards.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_showcase_cards_loss', true), '') <> 'on' THEN
    IF to_regclass('showcase_cards') IS NOT NULL THEN
      EXECUTE 'SELECT "candidature_id" FROM "showcase_cards" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'showcase cards exist (candidature %): they would be lost; SET LOCAL confluent.accept_showcase_cards_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('showcase_card_published', 'showcase_card_withdrawn') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'showcase cards are journaled (entry %): they would be lost; SET LOCAL confluent.accept_showcase_cards_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('showcase_card_published', 'showcase_card_withdrawn');

DROP TABLE IF EXISTS "showcase_cards";
