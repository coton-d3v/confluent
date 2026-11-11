-- ROADMAP E04.04: the provenance of each answer's current value, written with it by the only write
-- path (AnswersService.saveForDossier): origin (the person's own input, or a proposal of an AI
-- assistant), whether the person confirmed it, channel (site, administration, MCP), author, AI
-- application, and the document version it was taken from with where the cited excerpt was found.
--
-- Backfill: none on purpose. Who wrote an existing answer, and how, was never recorded; its
-- provenance stays unknown (all columns NULL) rather than guessed. The API shows it as `null`.
ALTER TABLE "dossier_answers"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "confirmation" TEXT,
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "author_id" TEXT,
  ADD COLUMN "client_name" TEXT,
  ADD COLUMN "source_document_id" TEXT,
  ADD COLUMN "source_location" TEXT,
  ADD COLUMN "source_excerpt" TEXT,
  ADD CONSTRAINT "dossier_answers_origin_check" CHECK ("origin" IN ('human', 'ai')),
  ADD CONSTRAINT "dossier_answers_confirmation_check" CHECK ("confirmation" IN ('confirmed', 'pending')),
  ADD CONSTRAINT "dossier_answers_channel_check" CHECK ("channel" IN ('site', 'admin', 'mcp')),
  -- Recorded as a whole, or not at all (an answer saved before E04.04).
  ADD CONSTRAINT "dossier_answers_provenance_check" CHECK (
    ("origin" IS NULL AND "confirmation" IS NULL AND "channel" IS NULL)
    OR ("origin" IS NOT NULL AND "confirmation" IS NOT NULL AND "channel" IS NOT NULL)
  ),
  -- The person's own input needs no confirmation; only a proposal can wait for one.
  ADD CONSTRAINT "dossier_answers_human_confirmed_check" CHECK ("origin" <> 'human' OR "confirmation" = 'confirmed'),
  -- An application is named only for an answer written through MCP.
  ADD CONSTRAINT "dossier_answers_client_name_check" CHECK ("client_name" IS NULL OR "channel" = 'mcp');

CREATE INDEX "dossier_answers_author_id_idx" ON "dossier_answers"("author_id");
CREATE INDEX "dossier_answers_source_document_id_idx" ON "dossier_answers"("source_document_id");

ALTER TABLE "dossier_answers" ADD CONSTRAINT "dossier_answers_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dossier_answers" ADD CONSTRAINT "dossier_answers_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
