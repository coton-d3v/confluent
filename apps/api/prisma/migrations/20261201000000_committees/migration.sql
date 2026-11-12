-- ROADMAP E08.01: the committees (pitch sessions) a workspace organises. Rules and limits:
-- @confluent/shared `committee.schema.ts` and `rules/zoned-time.ts`.
--
--  * `committees`: one row per committee of one workspace — its name; when, as the manager typed it
--    (`local_start`: wall-clock date and time to the minute, without time zone, in the IANA zone
--    `time_zone`) and the instant that designates (`starts_at`, UTC like every other timestamp,
--    derived by the API at each write of the schedule); where (`location`, one line, and/or
--    `meeting_url`, an https link); its status (`planned`, `held`, `cancelled` — cancelling is a
--    status, a committee is never deleted); the workspace's own information (`internal_notes`, read
--    only by those who read its committees); its version (grows at each change: a change made
--    meanwhile is refused; never reused, as no row is ever deleted but with its workspace). Removed
--    with its workspace.
--  * The unique index `(id, workspace_id)`, implied by the primary key, is the target of the
--    composite foreign keys that will keep what joins a committee (E08.03) inside its workspace.
--  * `audit_action` gains `committee_created`, `committee_updated` and `committee_status_changed`.
--
-- CHECK: closed status, name and place on one trimmed bounded line, information in trimmed
-- paragraphs without markup, https link without spaces, zone named the IANA way (whether the zone
-- exists is checked by the API against its time zone data, which may differ from the database's),
-- minute precision, years 2000 to 2099, and `starts_at` within the offsets a real zone can have
-- (UTC−12 to UTC+14) of `local_start`.
--
-- Backfill: none — no committee existed before; the table starts empty.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/committees.pg-spec.ts). Undone by
-- prisma/checks/20261201000000_committees.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'committee_created';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'committee_updated';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'committee_status_changed';

CREATE TABLE IF NOT EXISTS "committees" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "local_start" TIMESTAMP(0) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "meeting_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "internal_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "committees_workspace_id_starts_at_idx" ON "committees"("workspace_id", "starts_at");

CREATE UNIQUE INDEX IF NOT EXISTS "committees_id_workspace_id_key" ON "committees"("id", "workspace_id");

ALTER TABLE "committees" DROP CONSTRAINT IF EXISTS "committees_workspace_id_fkey";

ALTER TABLE "committees" ADD CONSTRAINT "committees_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committees" DROP CONSTRAINT IF EXISTS "committees_check";

ALTER TABLE "committees" ADD CONSTRAINT "committees_check" CHECK (
  char_length("name") BETWEEN 1 AND 120
  AND "name" = btrim("name")
  AND "name" !~ '[[:cntrl:]]'
  AND strpos("name", '  ') = 0
  AND "local_start" = date_trunc('minute', "local_start")
  AND "local_start" >= TIMESTAMP '2000-01-01 00:00:00'
  AND "local_start" < TIMESTAMP '2100-01-01 00:00:00'
  AND char_length("time_zone") <= 64
  AND "time_zone" ~ '^(UTC|[A-Z][A-Za-z_-]+(/[A-Za-z0-9_+-]+){1,2})$'
  AND "starts_at" >= "local_start" - interval '14 hours'
  AND "starts_at" <= "local_start" + interval '12 hours'
  AND ("location" IS NULL OR (
    char_length("location") BETWEEN 1 AND 300
    AND "location" = btrim("location")
    AND "location" !~ '[[:cntrl:]]'
    AND strpos("location", '  ') = 0
  ))
  AND ("meeting_url" IS NULL OR (
    char_length("meeting_url") <= 500
    AND "meeting_url" ~ '^https://[^[:space:][:cntrl:]]+$'
  ))
  AND "status" IN ('planned', 'held', 'cancelled')
  AND ("internal_notes" IS NULL OR (
    char_length("internal_notes") BETWEEN 1 AND 5000
    AND "internal_notes" = btrim("internal_notes", E' \n')
    AND translate("internal_notes", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("internal_notes", E'\n\n\n') = 0
    AND "internal_notes" !~ '<[A-Za-z!/?]'
  ))
  AND "version" >= 1
);
