-- ROADMAP E08.03: a financing request's entries on the committees of a workspace — the entrepreneur
-- applies, a conseiller attaches the request; the other side accepts, refuses or withdraws. Rules:
-- @confluent/shared `committee-application.schema.ts`.
--
--  * `committee_applications`: one row per candidature and committee (unique index: no duplicate,
--    even when both sides act at the same moment) — its status, the side that made the last change
--    (`status_by`), who (`status_actor_id`, left empty if their account is deleted) and when, its
--    version (grows at each change: a change made meanwhile is refused; never reused, as the row is
--    kept and reused after a withdrawal and only goes with its candidature or committee).
--  * Both composite foreign keys carry `workspace_id` — to `committees (id, workspace_id)` (E08.01)
--    and `candidatures (id, workspace_id)` (E06.03's unique index) —: an entry never joins a
--    committee and a candidature of different workspaces. Removed with either.
--  * `audit_action` gains `committee_application_changed`.
--
-- CHECK: closed status and side; only the entrepreneur applies, only the structure proposes or
-- refuses; version from 1.
--
-- Backfill: none — no request was attached to a committee before; the table starts empty.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on a
-- partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/committee-applications.pg-spec.ts).
-- Undone by prisma/checks/20261203000000_committee_applications.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'committee_application_changed';

CREATE TABLE IF NOT EXISTS "committee_applications" (
    "id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_by" TEXT NOT NULL,
    "status_actor_id" TEXT,
    "status_changed_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "committee_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "committee_applications_committee_id_workspace_id_idx" ON "committee_applications"("committee_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "committee_applications_candidature_id_workspace_id_idx" ON "committee_applications"("candidature_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "committee_applications_status_actor_id_idx" ON "committee_applications"("status_actor_id");

CREATE UNIQUE INDEX IF NOT EXISTS "committee_applications_committee_id_candidature_id_key" ON "committee_applications"("committee_id", "candidature_id");

ALTER TABLE "committee_applications" DROP CONSTRAINT IF EXISTS "committee_applications_committee_id_workspace_id_fkey";

ALTER TABLE "committee_applications" ADD CONSTRAINT "committee_applications_committee_id_workspace_id_fkey" FOREIGN KEY ("committee_id", "workspace_id") REFERENCES "committees"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "committee_applications" DROP CONSTRAINT IF EXISTS "committee_applications_candidature_id_workspace_id_fkey";

ALTER TABLE "committee_applications" ADD CONSTRAINT "committee_applications_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "committee_applications" DROP CONSTRAINT IF EXISTS "committee_applications_status_actor_id_fkey";

ALTER TABLE "committee_applications" ADD CONSTRAINT "committee_applications_status_actor_id_fkey" FOREIGN KEY ("status_actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "committee_applications" DROP CONSTRAINT IF EXISTS "committee_applications_check";

ALTER TABLE "committee_applications" ADD CONSTRAINT "committee_applications_check" CHECK (
  "status" IN ('applied', 'proposed', 'accepted', 'refused', 'withdrawn')
  AND "status_by" IN ('owner', 'workspace')
  AND ("status" <> 'applied' OR "status_by" = 'owner')
  AND ("status" NOT IN ('proposed', 'refused') OR "status_by" = 'workspace')
  AND "version" >= 1
);
