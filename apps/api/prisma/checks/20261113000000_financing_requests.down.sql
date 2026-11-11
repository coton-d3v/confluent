-- Reverts migration 20261113000000_financing_requests (ROADMAP E05.07) before the application is
-- rolled back to E05.06. Dossiers, companies, documents and share links keep their rows and ids; a
-- company keeps all its dossiers (the E05.06 application reads several dossiers of a company, each
-- presenting the whole profile and library). Lost on the way back: the requests' presentation
-- (summary, objective, description, amount, types), their publication, their document selections,
-- and the journal entries of publications and selections, which the E05.06 application cannot read.
-- The four values added to `audit_action` stay (PostgreSQL cannot remove them; unused).
--
-- Going back WIDENS what share recipients read: under E05.06 a share shows the whole library its
-- level may read, every version included, while E05.07 shows only the selected documents, each at
-- its pinned or latest version. So the revert refuses while a dossier with an active share link
-- selects less than its company's whole library, pins a version, or follows a document that has
-- earlier versions (all selected and followed is not enough: the history would show again) —
-- unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_wider_shares = 'on';
-- (or revokes those share links first). Run in one transaction (psql --single-transaction), then
-- remove the migration's row so it can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113000000_financing_requests';
-- Going further back (E05.05's revert) still requires a single dossier per company.
-- Exercised by test/pg/financing-requests.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  narrowed TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_wider_shares', true), '') <> 'on' THEN
    SELECT d."id" INTO narrowed FROM "dossiers" d
    WHERE EXISTS (SELECT 1 FROM "share_links" s WHERE s."dossier_id" = d."id" AND s."status" = 'active')
      AND (
        EXISTS (
          SELECT 1 FROM "library_documents" l
          WHERE l."company_id" = d."company_id"
            AND NOT EXISTS (
              SELECT 1 FROM "dossier_documents" x
              WHERE x."dossier_id" = d."id" AND x."library_document_id" = l."id"
            )
        )
        OR EXISTS (
          SELECT 1 FROM "dossier_documents" x
          WHERE x."dossier_id" = d."id" AND x."pinned_version_id" IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM "documents" v
          WHERE v."company_id" = d."company_id"
          GROUP BY v."library_document_id"
          HAVING count(*) > 1
        )
      )
    LIMIT 1;
    IF narrowed IS NOT NULL THEN
      RAISE EXCEPTION 'dossier % is shared with a selection of documents or of versions: going back would show its whole library and every earlier version (SET LOCAL confluent.accept_wider_shares = ''on'' to accept)', narrowed;
    END IF;
  END IF;
END $$;

DROP TABLE "dossier_documents";

DROP INDEX "documents_id_library_document_id_key";

DROP INDEX "dossiers_id_company_id_key";

DROP INDEX "library_documents_id_company_id_key";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_summary_check";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_objective_check";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_description_check";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_amount_eur_check";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_financing_types_check";

ALTER TABLE "dossiers" DROP CONSTRAINT "dossiers_publication_status_check";

ALTER TABLE "dossiers" DROP COLUMN "summary";

ALTER TABLE "dossiers" DROP COLUMN "objective";

ALTER TABLE "dossiers" DROP COLUMN "description";

ALTER TABLE "dossiers" DROP COLUMN "amount_eur";

ALTER TABLE "dossiers" DROP COLUMN "financing_types";

ALTER TABLE "dossiers" DROP COLUMN "publication_status";

ALTER TABLE "dossiers" DROP COLUMN "published_at";

DELETE FROM "audit_log" WHERE "action_type" IN ('dossier_published', 'dossier_unpublished', 'dossier_document_selected', 'dossier_document_unselected');
