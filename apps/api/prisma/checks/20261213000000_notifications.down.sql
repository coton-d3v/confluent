-- Reverts migration 20261213000000_notifications (ROADMAP E10.03) before the application is rolled
-- back to E09.06. The notifications of committees' changes go back to `committee_notices` (E08.06),
-- row for row: same id, kind, recipient, committee, version, reasons, email state and dates. Lost on
-- the way back: every other notification (who was told of a share, a pledge, a decision… and what
-- became of its email — the emails already sent stay sent) and whether each one was read. To be run
-- FIRST, before the reverts of E09.06 to E08.01: the notifications reference `committees`,
-- `committee_applications` and `participation_requests`.
--
-- Without any such notification, nothing is lost. One would be, so the revert refuses unless the
-- operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_notifications_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261213000000_notifications';
-- Exercised by test/pg/notifications.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_notifications_loss', true), '') <> 'on'
     AND to_regclass('notifications') IS NOT NULL THEN
    EXECUTE 'SELECT "id" FROM "notifications"
             WHERE "kind" NOT IN (''committee_rescheduled'', ''committee_cancelled'', ''committee_restored'')
                OR "read_at" IS NOT NULL
             LIMIT 1' INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'notifications would be lost (notification %): who was told of an event, or that they read it; SET LOCAL confluent.accept_notifications_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

-- E08.06's table, as its migration created it.
CREATE TABLE IF NOT EXISTS "committee_notices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "committee_version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "application_id" TEXT,
    "participation_request_id" TEXT,
    "state" TEXT NOT NULL,
    "state_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "committee_notices_committee_id_workspace_id_idx" ON "committee_notices"("committee_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "committee_notices_recipient_id_idx" ON "committee_notices"("recipient_id");

CREATE INDEX IF NOT EXISTS "committee_notices_application_id_idx" ON "committee_notices"("application_id");

CREATE INDEX IF NOT EXISTS "committee_notices_participation_request_id_idx" ON "committee_notices"("participation_request_id");

CREATE UNIQUE INDEX IF NOT EXISTS "committee_notices_committee_id_committee_version_recipient__key" ON "committee_notices"("committee_id", "committee_version", "recipient_id");

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_committee_id_workspace_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_committee_id_workspace_id_fkey" FOREIGN KEY ("committee_id", "workspace_id") REFERENCES "committees"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_recipient_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_application_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "committee_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_participation_request_id_fkey";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_participation_request_id_fkey" FOREIGN KEY ("participation_request_id") REFERENCES "participation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_notices" DROP CONSTRAINT IF EXISTS "committee_notices_check";

ALTER TABLE "committee_notices" ADD CONSTRAINT "committee_notices_check" CHECK (
  "kind" IN ('rescheduled', 'cancelled', 'restored')
  AND "state" IN ('to_send', 'sending', 'sent', 'failed', 'superseded')
  AND "committee_version" >= 1
  AND ("application_id" IS NOT NULL OR "participation_request_id" IS NOT NULL)
);

DO $$
BEGIN
  IF to_regclass('notifications') IS NOT NULL THEN
    EXECUTE $restore$
      INSERT INTO "committee_notices" (
        "id", "workspace_id", "committee_id", "committee_version", "kind", "recipient_id",
        "application_id", "participation_request_id", "state", "state_at", "created_at"
      )
      SELECT "id", "workspace_id", "committee_id", "committee_version",
             substring("kind" FROM char_length('committee_') + 1), "recipient_id",
             "application_id", "participation_request_id", "email_state", "email_state_at",
             "created_at"
      FROM "notifications"
      WHERE "kind" IN ('committee_rescheduled', 'committee_cancelled', 'committee_restored')
      ON CONFLICT DO NOTHING
    $restore$;
  END IF;
END $$;

DROP TABLE IF EXISTS "notifications";
