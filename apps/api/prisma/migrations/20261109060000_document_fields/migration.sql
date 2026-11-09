-- ROADMAP E03.11: a document can answer an attachment field of the dossier's form. The field's read
-- level then applies to the file. Existing documents keep no field (Documents tab, `complet` level).
-- The API checks that the field is an attachment field of the dossier's own version.
ALTER TABLE "documents" ADD COLUMN "field_id" TEXT;

CREATE INDEX "documents_field_id_idx" ON "documents"("field_id");

ALTER TABLE "documents" ADD CONSTRAINT "documents_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "questionnaire_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
