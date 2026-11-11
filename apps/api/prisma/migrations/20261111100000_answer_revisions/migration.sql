-- ROADMAP E04.05: the history of an answer when an AI assistant is involved. Before a proposal is
-- corrected, replaced or confirmed, or before a value gives way to a proposal, the state it replaces
-- (value and provenance, same columns and rules as dossier_answers) is kept here, written by the
-- only write paths (AnswersService.saveForDossier and confirmProposal) under the dossier's lock.
--
-- Backfill: none on purpose. Earlier replaced values were never kept; nothing can be recovered.
CREATE TABLE "dossier_answer_revisions" (
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

    CONSTRAINT "dossier_answer_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dossier_answer_revisions_origin_check" CHECK ("origin" IN ('human', 'ai')),
    CONSTRAINT "dossier_answer_revisions_confirmation_check" CHECK ("confirmation" IN ('confirmed', 'pending')),
    CONSTRAINT "dossier_answer_revisions_channel_check" CHECK ("channel" IN ('site', 'admin', 'mcp')),
    -- Recorded as a whole, or not at all (a value saved before E04.04 replaced by a proposal).
    CONSTRAINT "dossier_answer_revisions_provenance_check" CHECK (
      ("origin" IS NULL AND "confirmation" IS NULL AND "channel" IS NULL)
      OR ("origin" IS NOT NULL AND "confirmation" IS NOT NULL AND "channel" IS NOT NULL)
    ),
    CONSTRAINT "dossier_answer_revisions_human_confirmed_check" CHECK ("origin" <> 'human' OR "confirmation" = 'confirmed'),
    CONSTRAINT "dossier_answer_revisions_client_name_check" CHECK ("client_name" IS NULL OR "channel" = 'mcp')
);

CREATE INDEX "dossier_answer_revisions_answer_id_idx" ON "dossier_answer_revisions"("answer_id");
CREATE INDEX "dossier_answer_revisions_author_id_idx" ON "dossier_answer_revisions"("author_id");
CREATE INDEX "dossier_answer_revisions_source_document_id_idx" ON "dossier_answer_revisions"("source_document_id");

ALTER TABLE "dossier_answer_revisions" ADD CONSTRAINT "dossier_answer_revisions_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "dossier_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dossier_answer_revisions" ADD CONSTRAINT "dossier_answer_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dossier_answer_revisions" ADD CONSTRAINT "dossier_answer_revisions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
