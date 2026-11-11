-- ROADMAP E06.08: the internal notes a workspace keeps on each candidature it receives. Limits and
-- text rule: @confluent/shared `intervention.schema.ts`.
--
--  * `candidature_notes`: one row per note — plain text in paragraphs (no markup), its author, its
--    version (grows at each change: a change made meanwhile is refused), when it was written,
--    rewritten (`edited_at`) and deleted (`deleted_at`: its text is erased, the row stays as the
--    trace « note supprimée »). The foreign key carries `workspace_id` (the candidatures' target is
--    E06.03's unique index): a note stays inside its candidature's workspace. Removed with its
--    candidature; an author's account deleted leaves the note without author.
--
-- Backfill: none — no note existed before. The journal of interventions reads the histories the
-- earlier tasks keep (statuses, step validations, journal entries of plans and eligibilities): no
-- other table.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any
-- prefix of this file, then the whole file, gives the same database
-- (test/pg/candidature-notes.pg-spec.ts). Undone by
-- prisma/checks/20261122000000_candidature_notes.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_note_updated';

CREATE TABLE IF NOT EXISTS "candidature_notes" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "body" TEXT,
    "author_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidature_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "candidature_notes_candidature_id_workspace_id_idx" ON "candidature_notes"("candidature_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "candidature_notes_author_id_idx" ON "candidature_notes"("author_id");

ALTER TABLE "candidature_notes" DROP CONSTRAINT IF EXISTS "candidature_notes_candidature_id_workspace_id_fkey";

ALTER TABLE "candidature_notes" ADD CONSTRAINT "candidature_notes_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "candidature_notes" DROP CONSTRAINT IF EXISTS "candidature_notes_author_id_fkey";

ALTER TABLE "candidature_notes" ADD CONSTRAINT "candidature_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A text exactly while the note is not deleted: trimmed paragraphs (line breaks only, at most one
-- blank line in a row), at most 4 000 characters, without anything that looks like an HTML tag.
ALTER TABLE "candidature_notes" DROP CONSTRAINT IF EXISTS "candidature_notes_check";

ALTER TABLE "candidature_notes" ADD CONSTRAINT "candidature_notes_check" CHECK (
  ("deleted_at" IS NULL) = ("body" IS NOT NULL)
  AND ("body" IS NULL OR (
    char_length("body") BETWEEN 1 AND 4000
    AND "body" = btrim("body", E' \n')
    AND translate("body", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("body", E'\n\n\n') = 0
    AND "body" !~ '<[A-Za-z!/?]'
  ))
  AND "version" >= 1
  AND ("edited_at" IS NULL OR "edited_at" >= "created_at")
  AND ("deleted_at" IS NULL OR "deleted_at" >= "created_at")
);
