-- ROADMAP E05.09, decision D01: one common company profile, reused as is, plus forms of each
-- structure's own.
--
--  * `questionnaires.workspace_id`: NULL for Confluent's own forms (the company profile, usage
--    `dossier`, designed by administrators); set for a workspace's forms, designed by its managers.
--    A workspace assigns one of them to the usage `candidature`: its complementary form. One form
--    per usage — per workspace for `candidature` — (partial unique indexes replacing the former
--    unique index on `usage`), and a usage only where it belongs (CHECK).
--  * `candidatures`: a financing request (dossier) presented to a workspace, at most once, with the
--    version of the workspace's complementary form it answers; `submitted_at` NULL while a draft.
--  * `candidature_answers` / `candidature_answer_revisions`: the candidature's own answers — private
--    to it — with the provenance and history rules of the profile's answers (E04.04, E04.05), the
--    same columns and CHECK constraints.
--
-- Backfill: none needed. Every existing form is Confluent's (`workspace_id` NULL, usage `dossier` or
-- none, which the new CHECK accepts) and no candidature exists yet.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added), so any
-- prefix of this file, then the whole file, gives the same database
-- (test/pg/workspace-forms.pg-spec.ts). Undone by
-- prisma/checks/20261115000000_workspace_forms.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_created';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_submitted';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_withdrawn';

-- 1. Forms of a workspace.
ALTER TABLE "questionnaires" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;

CREATE INDEX IF NOT EXISTS "questionnaires_workspace_id_idx" ON "questionnaires"("workspace_id");

ALTER TABLE "questionnaires" DROP CONSTRAINT IF EXISTS "questionnaires_workspace_id_fkey";

ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Confluent's usages for Confluent's forms, `candidature` for a workspace's (NULL: unassigned).
ALTER TABLE "questionnaires" DROP CONSTRAINT IF EXISTS "questionnaires_usage_check";

ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_usage_check" CHECK (
  "usage" IS NULL
  OR ("workspace_id" IS NULL AND "usage" = 'dossier')
  OR ("workspace_id" IS NOT NULL AND "usage" = 'candidature')
);

-- One form per usage among Confluent's forms, and per workspace among a workspace's.
CREATE UNIQUE INDEX IF NOT EXISTS "questionnaires_confluent_usage_key"
  ON "questionnaires"("usage") WHERE "workspace_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaires_workspace_usage_key"
  ON "questionnaires"("workspace_id", "usage") WHERE "workspace_id" IS NOT NULL;

DROP INDEX IF EXISTS "questionnaires_usage_key";

-- 2. Candidatures.
CREATE TABLE IF NOT EXISTS "candidatures" (
    "id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "form_version_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidatures_dossier_id_workspace_id_key" ON "candidatures"("dossier_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "candidatures_workspace_id_idx" ON "candidatures"("workspace_id");

CREATE INDEX IF NOT EXISTS "candidatures_form_version_id_idx" ON "candidatures"("form_version_id");

ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_dossier_id_fkey";

ALTER TABLE "candidatures" ADD CONSTRAINT "candidatures_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_workspace_id_fkey";

ALTER TABLE "candidatures" ADD CONSTRAINT "candidatures_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_form_version_id_fkey";

ALTER TABLE "candidatures" ADD CONSTRAINT "candidatures_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "questionnaire_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "candidatures" DROP CONSTRAINT IF EXISTS "candidatures_submitted_at_check";

ALTER TABLE "candidatures" ADD CONSTRAINT "candidatures_submitted_at_check" CHECK (
  "submitted_at" IS NULL OR "submitted_at" >= "created_at"
);

-- 3. A candidature's own answers, with their provenance (always recorded: none predates E04.04).
CREATE TABLE IF NOT EXISTS "candidature_answers" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "origin" TEXT,
    "confirmation" TEXT,
    "channel" TEXT,
    "author_id" TEXT,
    "client_name" TEXT,
    "source_document_id" TEXT,
    "source_location" TEXT,
    "source_excerpt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidature_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidature_answers_candidature_id_field_id_key" ON "candidature_answers"("candidature_id", "field_id");

CREATE INDEX IF NOT EXISTS "candidature_answers_field_id_idx" ON "candidature_answers"("field_id");

CREATE INDEX IF NOT EXISTS "candidature_answers_author_id_idx" ON "candidature_answers"("author_id");

CREATE INDEX IF NOT EXISTS "candidature_answers_source_document_id_idx" ON "candidature_answers"("source_document_id");

ALTER TABLE "candidature_answers" DROP CONSTRAINT IF EXISTS "candidature_answers_candidature_id_fkey";

ALTER TABLE "candidature_answers" ADD CONSTRAINT "candidature_answers_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "candidatures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidature_answers" DROP CONSTRAINT IF EXISTS "candidature_answers_field_id_fkey";

ALTER TABLE "candidature_answers" ADD CONSTRAINT "candidature_answers_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "questionnaire_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "candidature_answers" DROP CONSTRAINT IF EXISTS "candidature_answers_author_id_fkey";

ALTER TABLE "candidature_answers" ADD CONSTRAINT "candidature_answers_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_answers" DROP CONSTRAINT IF EXISTS "candidature_answers_source_document_id_fkey";

ALTER TABLE "candidature_answers" ADD CONSTRAINT "candidature_answers_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_answers" DROP CONSTRAINT IF EXISTS "candidature_answers_provenance_check";

ALTER TABLE "candidature_answers" ADD CONSTRAINT "candidature_answers_provenance_check" CHECK (
  "origin" IS NOT NULL AND "confirmation" IS NOT NULL AND "channel" IS NOT NULL
  AND "origin" IN ('human', 'ai')
  AND "confirmation" IN ('confirmed', 'pending')
  AND "channel" IN ('site', 'admin', 'mcp')
  -- The person's own input needs no confirmation; only a proposal can wait for one.
  AND ("origin" <> 'human' OR "confirmation" = 'confirmed')
  -- An application is named only for an answer written through MCP.
  AND ("client_name" IS NULL OR "channel" = 'mcp')
);

-- 4. States those answers held before they gave way, when an AI assistant is involved (E04.05).
CREATE TABLE IF NOT EXISTS "candidature_answer_revisions" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "origin" TEXT,
    "confirmation" TEXT,
    "channel" TEXT,
    "author_id" TEXT,
    "client_name" TEXT,
    "source_document_id" TEXT,
    "source_location" TEXT,
    "source_excerpt" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "replaced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidature_answer_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "candidature_answer_revisions_answer_id_idx" ON "candidature_answer_revisions"("answer_id");

CREATE INDEX IF NOT EXISTS "candidature_answer_revisions_author_id_idx" ON "candidature_answer_revisions"("author_id");

CREATE INDEX IF NOT EXISTS "candidature_answer_revisions_source_document_id_idx" ON "candidature_answer_revisions"("source_document_id");

ALTER TABLE "candidature_answer_revisions" DROP CONSTRAINT IF EXISTS "candidature_answer_revisions_answer_id_fkey";

ALTER TABLE "candidature_answer_revisions" ADD CONSTRAINT "candidature_answer_revisions_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "candidature_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidature_answer_revisions" DROP CONSTRAINT IF EXISTS "candidature_answer_revisions_author_id_fkey";

ALTER TABLE "candidature_answer_revisions" ADD CONSTRAINT "candidature_answer_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_answer_revisions" DROP CONSTRAINT IF EXISTS "candidature_answer_revisions_source_document_id_fkey";

ALTER TABLE "candidature_answer_revisions" ADD CONSTRAINT "candidature_answer_revisions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidature_answer_revisions" DROP CONSTRAINT IF EXISTS "candidature_answer_revisions_provenance_check";

ALTER TABLE "candidature_answer_revisions" ADD CONSTRAINT "candidature_answer_revisions_provenance_check" CHECK (
  "origin" IS NOT NULL AND "confirmation" IS NOT NULL AND "channel" IS NOT NULL
  AND "origin" IN ('human', 'ai')
  AND "confirmation" IN ('confirmed', 'pending')
  AND "channel" IN ('site', 'admin', 'mcp')
  AND ("origin" <> 'human' OR "confirmation" = 'confirmed')
  AND ("client_name" IS NULL OR "channel" = 'mcp')
);
