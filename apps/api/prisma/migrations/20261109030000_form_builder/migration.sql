-- ROADMAP E03.02/E03.03/E03.08: form builder — forms can be archived and left unassigned, and each
-- form has at most one draft and one published version.

-- A form is assigned to at most one usage, and a usage to at most one form (NULL = unassigned).
ALTER TABLE "questionnaires" ALTER COLUMN "usage" DROP NOT NULL;
CREATE UNIQUE INDEX "questionnaires_usage_key" ON "questionnaires"("usage");
ALTER TABLE "questionnaires" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "questionnaires" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "questionnaires" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "questionnaire_versions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "questionnaire_versions" SET "updated_at" = COALESCE("published_at", "created_at");
ALTER TABLE "questionnaire_versions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Only the draft is editable, and new dossiers take the published version: one of each per form.
CREATE UNIQUE INDEX "questionnaire_versions_one_draft_per_form"
  ON "questionnaire_versions"("questionnaire_id") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "questionnaire_versions_one_published_per_form"
  ON "questionnaire_versions"("questionnaire_id") WHERE "status" = 'published';

ALTER TYPE "audit_action" ADD VALUE 'form_created';
ALTER TYPE "audit_action" ADD VALUE 'form_updated';
ALTER TYPE "audit_action" ADD VALUE 'form_draft_created';
ALTER TYPE "audit_action" ADD VALUE 'form_draft_discarded';
