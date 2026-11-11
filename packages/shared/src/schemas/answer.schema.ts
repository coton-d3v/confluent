import { z } from 'zod'

export const answerSchema = z.object({
  fieldId: z.string().uuid(),
  value: z.string().max(10_000),
})

export const upsertAnswersSchema = z.object({
  answers: z.array(answerSchema).max(500),
})

// Provenance of an answer's current value (E04.04) — not to be confused with the sources a
// dossier's classification was computed from (R31).
// `human`: entered by the person (in the site, or given in a conversation with an AI assistant);
// `ai`: proposed by an AI assistant, e.g. read in a document.
export const answerOriginSchema = z.enum(['human', 'ai'])
// Whether the person confirmed the value: always `confirmed` for their own input; a proposal stays
// `pending` until they confirm it.
export const answerConfirmationSchema = z.enum(['confirmed', 'pending'])
// Where the value was written: the site, the administration, or an AI application through MCP.
export const answerChannelSchema = z.enum(['site', 'admin', 'mcp'])

// Limits of a cited excerpt, checked against the document's text.
export const ANSWER_EXCERPT_MAX_LENGTH = 500

export const answerProvenanceSchema = z.object({
  origin: answerOriginSchema,
  confirmation: answerConfirmationSchema,
  channel: answerChannelSchema,
  // Who wrote the value; null once that account is deleted.
  authorId: z.string().uuid().nullable(),
  // Name of the AI application (OAuth client) for `mcp`, as it registered itself.
  clientName: z.string().nullable(),
  recordedAt: z.string().datetime(),
  // Document version the value was taken from; `location` (page, sheet, slide) is where Confluent
  // found the cited excerpt in that version's text, never a location declared by the client.
  source: z
    .object({
      // Null once the document is no longer available.
      documentId: z.string().uuid().nullable(),
      filename: z.string().nullable(),
      version: z.number().int().positive().nullable(),
      location: z.string().nullable(),
      excerpt: z.string().max(ANSWER_EXCERPT_MAX_LENGTH).nullable(),
    })
    .nullable(),
})

// A state an answer held before it gave way (E04.05): kept when an AI assistant is involved — a
// proposal corrected, replaced or confirmed, or a value replaced by a proposal. `provenance` is
// that state's (null for a value saved before provenance was recorded); `replacedAt` is when it
// gave way.
export const answerRevisionSchema = z.object({
  value: z.string(),
  provenance: answerProvenanceSchema.nullable(),
  replacedAt: z.string().datetime(),
})

export const answerRowSchema = z.object({
  id: z.string().uuid(),
  dossierId: z.string().uuid(),
  fieldId: z.string().uuid(),
  value: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Owner only: absent for a shared reader; null for an answer saved before provenance was recorded.
  provenance: answerProvenanceSchema.nullable().optional(),
  // Owner only, newest first: the states this answer held before (E04.05).
  history: z.array(answerRevisionSchema).optional(),
})

// The owner confirms an AI proposal as they saw it (E04.05): its value and its `updatedAt`. If the
// answer changed since, nothing is confirmed.
export const confirmAnswerSchema = z.object({
  value: z.string().max(10_000),
  updatedAt: z.string().datetime(),
})

export type AnswerInput = z.infer<typeof answerSchema>
export type UpsertAnswersInput = z.infer<typeof upsertAnswersSchema>
export type AnswerOrigin = z.infer<typeof answerOriginSchema>
export type AnswerConfirmation = z.infer<typeof answerConfirmationSchema>
export type AnswerChannel = z.infer<typeof answerChannelSchema>
export type AnswerProvenance = z.infer<typeof answerProvenanceSchema>
export type AnswerRevision = z.infer<typeof answerRevisionSchema>
export type AnswerRow = z.infer<typeof answerRowSchema>
export type ConfirmAnswerInput = z.infer<typeof confirmAnswerSchema>
