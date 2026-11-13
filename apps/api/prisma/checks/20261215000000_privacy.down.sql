-- Reverts migration 20261215000000_privacy (ROADMAP E10.10) before the application is rolled back to
-- E10.08. To be run FIRST, before the reverts of E10.08 and earlier.
--
-- What would be lost: the deletion requests (who asked, who decided, the notes), the files still
-- queued for the storage cleanup (they would stay in the bucket), the notifications of a declined
-- request. With any of them, the revert refuses unless the operator accepts it explicitly for this
-- transaction:
--   SET LOCAL confluent.accept_privacy_loss = 'on';
-- The journal actions it added stay in the `audit_action` type (PostgreSQL cannot remove an enum
-- value); the earlier application never writes them, and its owner history hides unknown actions.
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261215000000_privacy';
-- Exercised by test/pg/privacy.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_privacy_loss', true), '') <> 'on' THEN
    IF to_regclass('account_deletion_requests') IS NOT NULL THEN
      EXECUTE 'SELECT "id" FROM "account_deletion_requests" LIMIT 1' INTO found;
    END IF;
    IF found IS NULL AND to_regclass('storage_deletions') IS NOT NULL THEN
      EXECUTE 'SELECT "storage_key" FROM "storage_deletions" LIMIT 1' INTO found;
    END IF;
    IF found IS NULL THEN
      SELECT "id" INTO found FROM "notifications" WHERE "kind" = 'account_deletion_declined' LIMIT 1;
    END IF;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'personal data records would be lost (%): deletion requests, files queued for deletion or their notifications; SET LOCAL confluent.accept_privacy_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "notifications" WHERE "kind" = 'account_deletion_declined';

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_check";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_check" CHECK (
  "kind" IN (
    'share_invited', 'share_level_changed', 'share_revoked',
    'workspace_invited',
    'company_transfer_proposed', 'company_transfer_answered',
    'interest_received', 'pledge_received',
    'candidature_status_changed', 'committee_application_changed', 'showcase_card_hidden',
    'participation_accepted', 'entrepreneur_access_accepted',
    'participation_request_received', 'entrepreneur_access_request_received',
    'committee_rescheduled', 'committee_cancelled', 'committee_restored'
  )
  AND "email_state" IN ('none', 'to_send', 'sending', 'sent', 'failed', 'superseded')
  AND char_length("dedup_key") BETWEEN 1 AND 300
  AND char_length("subject_key") BETWEEN 1 AND 300
  AND jsonb_typeof("payload") = 'object'
  AND (
    "kind" IN ('committee_rescheduled', 'committee_cancelled', 'committee_restored')
  ) = (
    "committee_id" IS NOT NULL
    AND "committee_version" IS NOT NULL
    AND "workspace_id" IS NOT NULL
    AND ("application_id" IS NOT NULL OR "participation_request_id" IS NOT NULL)
  )
  AND ("committee_version" IS NULL OR "committee_version" >= 1)
  -- A committee's change is always emailed (E08.06).
  AND ("committee_id" IS NULL OR "email_state" <> 'none')
);

DROP TRIGGER IF EXISTS "documents_storage_cleanup" ON "documents";

DROP FUNCTION IF EXISTS "documents_storage_cleanup"();

DROP TABLE IF EXISTS "storage_deletions";

DROP TABLE IF EXISTS "account_deletion_requests";
