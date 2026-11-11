-- Reverts migration 20261118000000_funding_source_categories (ROADMAP E06.02) before the application
-- is rolled back to E06.01. Nothing else references the categories yet (E06.03 will). Lost on the
-- way back: the categories of every workspace and the journal entries of their configuration; the
-- value added to `audit_action` stays (PostgreSQL cannot remove it; unused).
--
-- A workspace that kept D04's defaults loses nothing a new run of the migration does not give back.
-- A configured one — a category renamed, reordered, deactivated or added — would lose its managers'
-- choices, so the revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_funding_sources_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118000000_funding_source_categories';
-- Exercised by test/pg/funding-source-categories.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_funding_sources_loss', true), '') <> 'on' THEN
    SELECT c."workspace_id" INTO found
    FROM "funding_source_categories" c
    LEFT JOIN (VALUES
      ('bpifrance', 'Bpifrance', 'aides_publiques', 0),
      ('pret_honneur', 'Prêt d’honneur', 'pret_honneur', 1),
      ('pret_bancaire', 'Prêt bancaire', 'pret_bancaire', 2),
      ('business_angels_love_money', 'Business angels / love money', 'business_angels_love_money', 3),
      ('fonds_investissement', 'Fonds d’investissement', 'fonds_investissement', 4),
      ('fonds_propres', 'Fonds propres', 'fonds_propres', 5)
    ) AS d("key", "label", "family", "position")
      ON d."key" = c."key" AND d."label" = c."label" AND d."family" = c."family" AND d."position" = c."position"
    WHERE d."key" IS NULL OR NOT c."active"
    LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'configured funding source categories exist (workspace %): they would be lost; SET LOCAL confluent.accept_funding_sources_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" = 'funding_source_categories_updated';

DROP TABLE IF EXISTS "funding_source_categories";
