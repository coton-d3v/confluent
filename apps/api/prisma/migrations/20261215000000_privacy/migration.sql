-- ROADMAP E10.10: personal data — deletion requests, the cleanup of deleted documents' files, and the
-- journal actions and notification of both (rules: @confluent/shared `privacy.schema.ts`).
--
--  * `account_deletion_requests`: a person's request to delete their account, then an
--    administrator's decision. `pending` → `completed` | `declined` | `cancelled`; at most one pending
--    request per account (partial unique index). `user_id` SET NULL once the account is deleted — a
--    completed request never points to an account (CHECK) —; `subject_ref` names it from then on.
--    `decided_by_id` SET NULL if the administrator's account goes. CHECK: closed status and email
--    outcome, each status tied to its decision columns (a pending one has none, a declined one a
--    note of 1 to 1,000 characters, a completed one a summary object), bounded pseudonym.
--  * `storage_deletions`: the stored files whose document rows were deleted, to remove from the
--    storage after the commit. Filled by the trigger `documents_storage_cleanup` (AFTER DELETE on
--    `documents`, every row, cascades included: a request, a company or an account deleted), in the
--    deleting transaction — a rollback leaves nothing to clean —, one row per key. Before E10.10 a
--    deleted request's files stayed in the bucket (E10.08's open point); those are not searched for.
--  * `audit_action`: `personal_data_exported`, `account_deletion_requested`,
--    `account_deletion_cancelled`, `account_deletion_declined`, `account_deleted`.
--  * `notifications.kind`: `account_deletion_declined` (the CHECK of migration
--    20261213000000_notifications, rewritten with it).
--
-- No data changes. Deployment resume: each statement can run again on a partly migrated database
-- (IF [NOT] EXISTS, constraints dropped before being added, CREATE OR REPLACE).

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'personal_data_exported';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'account_deletion_requested';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'account_deletion_cancelled';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'account_deletion_declined';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'account_deleted';

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "subject_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decline_note" TEXT,
    "summary" JSONB,
    "confirmation_email" TEXT,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "storage_deletions" (
    "storage_key" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "storage_deletions_pkey" PRIMARY KEY ("storage_key")
);

CREATE INDEX IF NOT EXISTS "account_deletion_requests_user_id_idx" ON "account_deletion_requests"("user_id");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_status_requested_at_idx" ON "account_deletion_requests"("status", "requested_at");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_decided_by_id_idx" ON "account_deletion_requests"("decided_by_id");

-- At most one pending request per account (not in schema.prisma: Prisma cannot express a partial
-- index).
CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_requests_one_pending_key" ON "account_deletion_requests"("user_id") WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "storage_deletions_requested_at_idx" ON "storage_deletions"("requested_at");

ALTER TABLE "account_deletion_requests" DROP CONSTRAINT IF EXISTS "account_deletion_requests_user_id_fkey";

ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_deletion_requests" DROP CONSTRAINT IF EXISTS "account_deletion_requests_decided_by_id_fkey";

ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_deletion_requests" DROP CONSTRAINT IF EXISTS "account_deletion_requests_check";

ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_check" CHECK (
  "status" IN ('pending', 'completed', 'declined', 'cancelled')
  AND char_length("subject_ref") BETWEEN 1 AND 100
  AND ("status" = 'pending') = ("decided_at" IS NULL)
  AND ("status" <> 'pending' OR "user_id" IS NOT NULL)
  AND ("status" <> 'completed' OR "user_id" IS NULL)
  AND ("status" = 'declined') = ("decline_note" IS NOT NULL)
  AND ("decline_note" IS NULL OR char_length("decline_note") BETWEEN 1 AND 1000)
  AND ("status" = 'completed') = ("summary" IS NOT NULL)
  AND ("summary" IS NULL OR jsonb_typeof("summary") = 'object')
  AND ("confirmation_email" IS NULL OR ("status" = 'completed' AND "confirmation_email" IN ('sent', 'failed')))
  AND ("status" IN ('declined', 'completed') OR "decided_by_id" IS NULL)
);

ALTER TABLE "storage_deletions" DROP CONSTRAINT IF EXISTS "storage_deletions_check";

ALTER TABLE "storage_deletions" ADD CONSTRAINT "storage_deletions_check" CHECK (
  char_length("storage_key") BETWEEN 1 AND 1024
  AND "attempts" >= 0
  AND ("last_error" IS NULL OR char_length("last_error") <= 500)
);

CREATE OR REPLACE FUNCTION "documents_storage_cleanup"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "storage_deletions" ("storage_key") VALUES (OLD."storage_key")
  ON CONFLICT ("storage_key") DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "documents_storage_cleanup" ON "documents";

CREATE TRIGGER "documents_storage_cleanup" AFTER DELETE ON "documents"
FOR EACH ROW EXECUTE FUNCTION "documents_storage_cleanup"();

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
    'committee_rescheduled', 'committee_cancelled', 'committee_restored',
    'account_deletion_declined'
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
