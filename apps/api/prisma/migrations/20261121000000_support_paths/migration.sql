-- ROADMAP E06.06: the support path (« parcours d'accompagnement ») of each workspace, and the steps
-- validated for each candidature it receives. Default steps, limits and closed values:
-- @confluent/shared `support-path.schema.ts`.
--
--  * `support_steps`: one row per step of a workspace's path — `key` (stable, unique in the
--    workspace) fixed at creation; `label` (unique in the workspace), `explanation` (plain text in
--    paragraphs, no markup), `position` and `active` configured by its managers. Deactivated, never
--    deleted; removed with its workspace only.
--  * `candidature_step_validations`: where one step stands for a candidature — validated (when, by
--    whom) or not (its validation withdrawn) —, created at the first validation, with a version that
--    grows at each change. Both foreign keys carry `workspace_id` (the candidatures' target is
--    E06.03's unique index): a candidature is only validated on steps of its own workspace. One per
--    candidature and step. Removed with its candidature; a step validated once cannot be deleted.
--  * `candidature_step_validation_changes`: the history — each validation and each withdrawal, who
--    and when —, removed with its validation.
--
-- Backfill, explicit: every existing workspace gets the three default steps, in order, active, with
-- an id derived from the workspace and the key (the same on every run). A workspace created
-- afterwards gets them from the API, in the transaction that creates it. No validation existed
-- before: none is backfilled.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF [NOT] EXISTS, constraints dropped before being added, backfill
-- skipping the steps already there), so any prefix of this file, then the whole file, gives the same
-- database (test/pg/support-paths.pg-spec.ts). Undone by
-- prisma/checks/20261121000000_support_paths.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'support_steps_updated';

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'candidature_support_step_updated';

CREATE TABLE IF NOT EXISTS "support_steps" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "explanation" TEXT,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_steps_workspace_id_key_key" ON "support_steps"("workspace_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "support_steps_workspace_id_label_key" ON "support_steps"("workspace_id", "label");

CREATE UNIQUE INDEX IF NOT EXISTS "support_steps_id_workspace_id_key" ON "support_steps"("id", "workspace_id");

ALTER TABLE "support_steps" DROP CONSTRAINT IF EXISTS "support_steps_workspace_id_fkey";

ALTER TABLE "support_steps" ADD CONSTRAINT "support_steps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Key as the API derives it; label on one trimmed line; explanation in trimmed paragraphs (line
-- breaks only, at most one blank line in a row), without anything that looks like an HTML tag.
ALTER TABLE "support_steps" DROP CONSTRAINT IF EXISTS "support_steps_check";

ALTER TABLE "support_steps" ADD CONSTRAINT "support_steps_check" CHECK (
  "key" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
  AND char_length("key") <= 60
  AND char_length("label") BETWEEN 1 AND 80
  AND "label" = btrim("label")
  AND "label" !~ '[[:cntrl:]]'
  AND ("explanation" IS NULL OR (
    char_length("explanation") BETWEEN 1 AND 1000
    AND "explanation" = btrim("explanation", E' \n')
    AND translate("explanation", E'\n', '') !~ '[[:cntrl:]]'
    AND strpos("explanation", E'\n\n\n') = 0
    AND "explanation" !~ '<[A-Za-z!/?]'
  ))
  AND "position" >= 0
);

CREATE TABLE IF NOT EXISTS "candidature_step_validations" (
    "id" TEXT NOT NULL,
    "candidature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "validated_at" TIMESTAMP(3),
    "validated_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidature_step_validations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candidature_step_validations_candidature_id_step_id_key" ON "candidature_step_validations"("candidature_id", "step_id");

CREATE INDEX IF NOT EXISTS "candidature_step_validations_step_id_workspace_id_idx" ON "candidature_step_validations"("step_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "candidature_step_validations_validated_by_id_idx" ON "candidature_step_validations"("validated_by_id");

ALTER TABLE "candidature_step_validations" DROP CONSTRAINT IF EXISTS "candidature_step_validations_candidature_id_workspace_id_fkey";

ALTER TABLE "candidature_step_validations" ADD CONSTRAINT "candidature_step_validations_candidature_id_workspace_id_fkey" FOREIGN KEY ("candidature_id", "workspace_id") REFERENCES "candidatures"("id", "workspace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "candidature_step_validations" DROP CONSTRAINT IF EXISTS "candidature_step_validations_step_id_workspace_id_fkey";

ALTER TABLE "candidature_step_validations" ADD CONSTRAINT "candidature_step_validations_step_id_workspace_id_fkey" FOREIGN KEY ("step_id", "workspace_id") REFERENCES "support_steps"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "candidature_step_validations" DROP CONSTRAINT IF EXISTS "candidature_step_validations_validated_by_id_fkey";

ALTER TABLE "candidature_step_validations" ADD CONSTRAINT "candidature_step_validations_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A validator only with a validation date (the validator's account may disappear: the date stays).
ALTER TABLE "candidature_step_validations" DROP CONSTRAINT IF EXISTS "candidature_step_validations_check";

ALTER TABLE "candidature_step_validations" ADD CONSTRAINT "candidature_step_validations_check" CHECK (
  ("validated_by_id" IS NULL OR "validated_at" IS NOT NULL)
  AND "version" >= 1
);

CREATE TABLE IF NOT EXISTS "candidature_step_validation_changes" (
    "id" TEXT NOT NULL,
    "validation_id" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "actor_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidature_step_validation_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "candidature_step_validation_changes_validation_id_idx" ON "candidature_step_validation_changes"("validation_id");

CREATE INDEX IF NOT EXISTS "candidature_step_validation_changes_actor_id_idx" ON "candidature_step_validation_changes"("actor_id");

ALTER TABLE "candidature_step_validation_changes" DROP CONSTRAINT IF EXISTS "candidature_step_validation_changes_validation_id_fkey";

ALTER TABLE "candidature_step_validation_changes" ADD CONSTRAINT "candidature_step_validation_changes_validation_id_fkey" FOREIGN KEY ("validation_id") REFERENCES "candidature_step_validations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidature_step_validation_changes" DROP CONSTRAINT IF EXISTS "candidature_step_validation_changes_actor_id_fkey";

ALTER TABLE "candidature_step_validation_changes" ADD CONSTRAINT "candidature_step_validation_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The two changes of a validation.
ALTER TABLE "candidature_step_validation_changes" DROP CONSTRAINT IF EXISTS "candidature_step_validation_changes_check";

ALTER TABLE "candidature_step_validation_changes" ADD CONSTRAINT "candidature_step_validation_changes_check" CHECK (
  "change" IN ('validated', 'reopened')
);

-- Backfill: the default steps for every existing workspace. The id is a version-4 shaped UUID (as the
-- API's ids, which the contracts validate) drawn from md5(workspace, key).
INSERT INTO "support_steps" ("id", "workspace_id", "key", "label", "explanation", "position", "active", "updated_at")
SELECT
  substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12),
  "workspace_id", "key", "label", "explanation", "position", true, CURRENT_TIMESTAMP
FROM (
  SELECT md5('support-step:' || w."id" || ':' || d."key") AS h, w."id" AS "workspace_id", d.*
  FROM "workspaces" w
  CROSS JOIN (VALUES
    ('diagnostic', 'Diagnostic', 'Un premier échange avec votre conseiller pour faire le point sur le projet, l’équipe et les besoins de financement, et convenir des étapes suivantes.', 0),
    ('business_plan', 'Business plan', 'Le business plan et le prévisionnel financier sont rédigés, puis relus avec votre conseiller.', 1),
    ('pitch', 'Pitch', 'La présentation du projet est prête et a été répétée avec votre conseiller avant d’être présentée aux financeurs.', 2)
  ) AS d("key", "label", "explanation", "position")
) AS backfill
ON CONFLICT DO NOTHING;
