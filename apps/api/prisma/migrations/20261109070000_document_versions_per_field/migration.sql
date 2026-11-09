-- Code review R48 (E03.11): a document is versioned per question it answers. Files of the same name
-- sent for two attachment questions (or for a question and the Documents tab) are two documents,
-- each with its own versions from 1. Existing rows all have no field: their numbering is unchanged.
-- PostgreSQL treats NULL field ids as distinct in this index; version numbers are therefore
-- assigned under the dossier's row lock (DocumentsService.upload), not by this index alone.
DROP INDEX "documents_dossier_id_filename_version_key";

CREATE UNIQUE INDEX "documents_dossier_id_field_id_filename_version_key" ON "documents"("dossier_id", "field_id", "filename", "version");
