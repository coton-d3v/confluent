-- Reverts migration 20261117000000_statuses (ROADMAP E06.01) before the application is rolled back
-- to E05.10. Dossiers, candidatures and their answers keep their rows and ids. Lost on the way back:
-- the archiving of requests (an archived request becomes a draft again, which diffuses nothing),
-- the financing statuses decided in the workspaces and the journal of their changes, and the journal
-- entries of these actions; the three values added to `audit_action` stay (PostgreSQL cannot remove
-- them; unused).
--
-- That loss is the structures' and the entrepreneurs' decisions, so the revert refuses while a
-- request is archived or a candidature has left `preparing` or recorded a change, unless the
-- operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_statuses_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261117000000_statuses';
-- Exercised by test/pg/statuses.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_statuses_loss', true), '') <> 'on' THEN
    SELECT "id" INTO found FROM "dossiers" WHERE "publication_status" = 'archived' LIMIT 1;
    IF found IS NULL THEN
      SELECT "id" INTO found FROM "candidatures" WHERE "financing_status" <> 'preparing' LIMIT 1;
    END IF;
    IF found IS NULL THEN
      SELECT "candidature_id" INTO found FROM "candidature_status_changes" LIMIT 1;
    END IF;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'archived requests or financing statuses exist (%): they would be lost; SET LOCAL confluent.accept_statuses_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" IN ('dossier_archived', 'dossier_unarchived', 'candidature_status_changed');

DROP TABLE IF EXISTS "candidature_status_changes";

ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_financing_status_check";

ALTER TABLE "candidatures" DROP COLUMN IF EXISTS "financing_status_changed_at";

ALTER TABLE "candidatures" DROP COLUMN IF EXISTS "financing_status";

ALTER TABLE "dossiers" DROP CONSTRAINT IF EXISTS "dossiers_publication_status_check";

UPDATE "dossiers" SET "publication_status" = 'draft' WHERE "publication_status" = 'archived';

ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_publication_status_check" CHECK (
  "publication_status" IN ('draft', 'published')
  AND ("publication_status" = 'published') = ("published_at" IS NOT NULL)
);

ALTER TABLE "dossiers" DROP COLUMN IF EXISTS "archived_at";
