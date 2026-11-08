-- Concurrent uploads of the same filename could create two rows with the same version. Renumber any
-- such duplicates by creation order (no-op when versions are already consistent) before enforcing
-- uniqueness, so the migration cannot fail on existing data.
UPDATE "documents" AS d
SET "version" = r."rn"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "dossier_id", "filename" ORDER BY "version", "created_at", "id") AS "rn"
  FROM "documents"
  WHERE ("dossier_id", "filename") IN (
    SELECT "dossier_id", "filename" FROM "documents"
    GROUP BY "dossier_id", "filename", "version" HAVING COUNT(*) > 1
  )
) AS r
WHERE d."id" = r."id" AND d."version" <> r."rn";

-- DropIndex
DROP INDEX "documents_dossier_id_filename_version_idx";

-- CreateIndex
CREATE UNIQUE INDEX "documents_dossier_id_filename_version_key" ON "documents"("dossier_id", "filename", "version");
