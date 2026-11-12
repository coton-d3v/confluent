-- ROADMAP E10.03: notifications (rules: @confluent/shared `notification.schema.ts`).
--
--  * `notifications`: one person (`recipient_id`, an account — never an address) told of one event
--    (`kind`, a closed list). Never twice for the same event and person: `dedup_key` (the event, its
--    object and, when the object has one, its version) is unique per recipient. `subject_key`: the
--    object it is about, whose later notification supersedes an email still unsent. `payload`: the
--    fields the text is written from (a JSON object; the API keeps only the kind's allowlist).
--    `read_at`: when the recipient marked it read. `email_state`: `none` for an in-app-only kind;
--    otherwise `to_send` (recorded with the event), `sending` (claimed by its sender), `sent`,
--    `failed`, or `superseded`; and when it last changed (`email_state_at`).
--  * Removed with the account, and with the workspace, request or committee it hangs on. A
--    committee's change (E08.06) keeps what `committee_notices` held: the committee (composite key
--    `committees (id, workspace_id)`, kept inside its workspace) at the version the change produced,
--    and why the person is told — the entry of their request (`application_id`) and/or their
--    accepted participation request (`participation_request_id`), removed with them.
--
-- CHECK: closed kind and email state lists; a committee's change, and only one, names its committee,
-- version from 1, its workspace and a reason, and has an email; payload an object; keys of bounded
-- length.
--
-- Backfill: every row of `committee_notices` (E08.06) becomes a notification of the same id, kind
-- (`committee_<kind>`), recipient, committee, version, reasons, email state and dates, unread. Its
-- text is written from the committee and workspace as they are now (name, date) — the emails sent
-- then are unchanged —, without the previous date of a change (not recorded by E08.06). Then
-- `committee_notices` is dropped: its rows live on as notifications.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill ON
-- CONFLICT DO NOTHING and only while `committee_notices` exists), so any prefix of this file, then the
-- whole file, gives the same database (test/pg/notifications.pg-spec.ts).
-- Undone by prisma/checks/20261213000000_notifications.down.sql.

CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "workspace_id" TEXT,
    "dossier_id" TEXT,
    "committee_id" TEXT,
    "committee_version" INTEGER,
    "application_id" TEXT,
    "participation_request_id" TEXT,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "email_state" TEXT NOT NULL,
    "email_state_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_recipient_id_created_at_id_idx" ON "notifications"("recipient_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "notifications_committee_id_workspace_id_idx" ON "notifications"("committee_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "notifications_workspace_id_idx" ON "notifications"("workspace_id");

CREATE INDEX IF NOT EXISTS "notifications_dossier_id_idx" ON "notifications"("dossier_id");

CREATE INDEX IF NOT EXISTS "notifications_application_id_idx" ON "notifications"("application_id");

CREATE INDEX IF NOT EXISTS "notifications_participation_request_id_idx" ON "notifications"("participation_request_id");

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_recipient_id_dedup_key_key" ON "notifications"("recipient_id", "dedup_key");

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_recipient_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_workspace_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_dossier_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_committee_id_workspace_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_committee_id_workspace_id_fkey" FOREIGN KEY ("committee_id", "workspace_id") REFERENCES "committees"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_application_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "committee_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_participation_request_id_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_participation_request_id_fkey" FOREIGN KEY ("participation_request_id") REFERENCES "participation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- Backfill from E08.06, only while its table exists (a resumed deployment that already dropped it
-- skips this block).
DO $$
BEGIN
  IF to_regclass('committee_notices') IS NOT NULL THEN
    EXECUTE $backfill$
      INSERT INTO "notifications" (
        "id", "recipient_id", "kind", "dedup_key", "subject_key", "workspace_id", "committee_id",
        "committee_version", "application_id", "participation_request_id", "payload", "read_at",
        "email_state", "email_state_at", "created_at"
      )
      SELECT
        n."id", n."recipient_id", 'committee_' || n."kind",
        'committee_changed:' || n."committee_id" || ':' || n."committee_version",
        'committee:' || n."committee_id",
        n."workspace_id", n."committee_id", n."committee_version", n."application_id",
        n."participation_request_id",
        jsonb_build_object(
          'workspaceId', w."id",
          'workspaceName', w."name",
          'committeeName', c."name",
          'date', to_char(c."local_start", 'YYYY-MM-DD'),
          'time', to_char(c."local_start", 'HH24:MI'),
          'timeZone', c."time_zone",
          'previous', NULL,
          'audience', CASE WHEN n."application_id" IS NOT NULL THEN 'entrepreneur' ELSE 'participant' END,
          'candidatureId', a."candidature_id"
        ),
        NULL, n."state", n."state_at", n."created_at"
      FROM "committee_notices" n
      JOIN "committees" c ON c."id" = n."committee_id"
      JOIN "workspaces" w ON w."id" = n."workspace_id"
      LEFT JOIN "committee_applications" a ON a."id" = n."application_id"
      ON CONFLICT DO NOTHING
    $backfill$;
  END IF;
END $$;

DROP TABLE IF EXISTS "committee_notices";
