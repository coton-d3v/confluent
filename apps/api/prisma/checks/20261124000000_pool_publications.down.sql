-- Reverts migration 20261124000000_pool_publications (ROADMAP E07.02) before the application is
-- rolled back to E07.01. Lost on the way back: every pool publication — active or withdrawn, with its
-- consent's date and author — and the journal entries of their publications and withdrawals; the
-- values added to `audit_action` stay (PostgreSQL cannot remove them; unused). The earlier
-- application has no pool: nothing it reads changes. To be run FIRST, before the reverts of E07.01
-- and of the earlier migrations — the publications' foreign key uses E06.03's unique index on
-- `candidatures (id, workspace_id)`.
--
-- Without any publication nor journal entry, nothing is lost. One would be — a consent is a trace
-- the owner may need —, so the revert refuses unless the operator accepts it explicitly for this
-- transaction:
--   SET LOCAL confluent.accept_pool_publications_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124000000_pool_publications';
-- Exercised by test/pg/pool-publications.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_pool_publications_loss', true), '') <> 'on' THEN
    IF to_regclass('pool_publications') IS NOT NULL THEN
      EXECUTE 'SELECT "candidature_id" FROM "pool_publications" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'pool publications exist (candidature %): they would be lost; SET LOCAL confluent.accept_pool_publications_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    SELECT "id" INTO found FROM "audit_log"
    WHERE "action_type"::text IN ('pool_publication_published', 'pool_publication_withdrawn') LIMIT 1;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'pool publications are journaled (entry %): they would be lost; SET LOCAL confluent.accept_pool_publications_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log"
WHERE "action_type"::text IN ('pool_publication_published', 'pool_publication_withdrawn');

DROP TABLE IF EXISTS "pool_publications";
