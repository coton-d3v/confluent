-- ROADMAP E07.08: reading sessions — a view is a session, with its dates and its active time (rules:
-- @confluent/shared `reading.schema.ts`).
--
--  * `reading_sessions`: one row per session of a reader on a request, opened by the server when the
--    reader loads the page of a share link or an opportunity (`channel`), resumed by their next loads
--    through the same direct share (`share_link_id`, or none) while its last activity
--    (`last_seen_at`) is less than 30 minutes old. `active_ms`: the active time credited by the server
--    from the page's heartbeats; `NULL` when not measured (a reading through pools alone, or one
--    taken before E07.08). Removed with the request or the share; the reader's account removed, the
--    view stays (`reader_id` emptied).
--
-- CHECK: `channel` in (`share`, `opportunity`); `active_ms` NULL or 0 to 3 hours (10 800 000 ms);
-- `last_seen_at` not before `started_at`.
--
-- Backfill: the views counted so far — the journal's `share_link_viewed` entries and the
-- `opportunity_viewed` entries made through a direct share, one view each — are grouped into sessions
-- by the same rule, per share: an entry less than 30 minutes after the previous one of the same share
-- continues its session. Each session: started at its first entry, last seen at its last one, through
-- the page of its first entry, read by the first entry's author or else the account of the share's
-- recipient, without a measured duration. A share's view count therefore becomes its number of
-- sessions: reloads, redirections and double loads counted before are counted once (the journal
-- itself is untouched). The readings through pools alone were never counted for the owner: no
-- session is made of them. The application journals one entry per session from now on.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, a session
-- inserted only once — same share, same start), so any prefix of this file, then the whole file, gives
-- the same database (test/pg/reading-sessions.pg-spec.ts). Undone by
-- prisma/checks/20261129000000_reading_sessions.down.sql.

CREATE TABLE IF NOT EXISTS "reading_sessions" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "reader_id" TEXT,
    "share_link_id" TEXT,
    "channel" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "active_ms" INTEGER,

    CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reading_sessions_reader_id_dossier_id_last_seen_at_idx" ON "reading_sessions"("reader_id", "dossier_id", "last_seen_at");

CREATE INDEX IF NOT EXISTS "reading_sessions_share_link_id_idx" ON "reading_sessions"("share_link_id");

CREATE INDEX IF NOT EXISTS "reading_sessions_dossier_id_idx" ON "reading_sessions"("dossier_id");

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_dossier_id_fkey";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_reader_id_fkey";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_share_link_id_fkey";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_channel_check";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_channel_check" CHECK ("channel" IN ('share', 'opportunity'));

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_active_ms_check";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_active_ms_check" CHECK ("active_ms" IS NULL OR ("active_ms" >= 0 AND "active_ms" <= 10800000));

ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_dates_check";

ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_dates_check" CHECK ("last_seen_at" >= "started_at");

INSERT INTO "reading_sessions" ("id", "dossier_id", "reader_id", "share_link_id", "channel", "started_at", "last_seen_at", "active_ms")
SELECT gen_random_uuid()::text, s."dossier_id",
       coalesce(s."actor_id", (SELECT u."id" FROM "users" u
                               WHERE lower(u."email") = lower(s."recipient_email")
                               ORDER BY u."id" LIMIT 1)),
       s."share_link_id",
       CASE WHEN s."first_action" = 'opportunity_viewed' THEN 'opportunity' ELSE 'share' END,
       s."started_at", s."last_seen_at", NULL
FROM (
  SELECT n."share_link_id", n."dossier_id", n."recipient_email",
         min(n."created_at") AS "started_at", max(n."created_at") AS "last_seen_at",
         (array_agg(n."action" ORDER BY n."created_at", n."id"))[1] AS "first_action",
         (array_agg(n."actor_id" ORDER BY n."created_at", n."id")
            FILTER (WHERE n."actor_id" IS NOT NULL))[1] AS "actor_id"
  FROM (
    SELECT v.*, sum(v."starts") OVER (PARTITION BY v."share_link_id" ORDER BY v."created_at", v."id") AS "session"
    FROM (
      SELECT a."id", a."share_link_id", l."dossier_id", l."recipient_email", a."actor_id",
             a."action_type"::text AS "action", a."created_at",
             CASE WHEN lag(a."created_at") OVER w IS NULL
                    OR a."created_at" - lag(a."created_at") OVER w > interval '30 minutes'
                  THEN 1 ELSE 0 END AS "starts"
      FROM "audit_log" a
      JOIN "share_links" l ON l."id" = a."share_link_id"
      WHERE a."action_type"::text IN ('share_link_viewed', 'opportunity_viewed')
      WINDOW w AS (PARTITION BY a."share_link_id" ORDER BY a."created_at", a."id")
    ) v
  ) n
  GROUP BY n."share_link_id", n."dossier_id", n."recipient_email", n."session"
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "reading_sessions" r
  WHERE r."share_link_id" = s."share_link_id" AND r."started_at" = s."started_at"
);
