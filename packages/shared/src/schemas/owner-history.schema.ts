import { z } from 'zod'
import { readingChannelSchema } from './reading.schema.js'

// ROADMAP E07.09 — the history of a request as its owner reads it (D05 still open: where it is
// silent, the most restrictive option). This file is the only place where these rules are described;
// the API applies them (`OwnerHistoryService`, `owner-history.rules.ts`), the site only shows them.
//
//  * One chronological view, the latest first, paginated and filtered by the server: the
//    consultations of the request's direct shares (E07.08's reading sessions: one per view, with
//    their page and active time — never a reading through pools alone, not even counted), what
//    happened to its shares (opened, level changed, revoked — by the owner or by the administration),
//    what the administration changed on it (an answer edited, a reclassification after new rules, a
//    document added) and the steps of the request itself (submitted, published, back to draft,
//    archived, unarchived — with the AI application that asked, when one did).
//  * Read from the journal through a closed list: each journal action is classified once, shown or
//    hidden with its reason; an action nobody classified is hidden (and the API's tests fail until it
//    is). Each entry is described anew from what the owner may know — a sentence in French, the
//    recipient's address they chose, the label of their own question —, never the raw entry.
//  * Never shown: who acted besides the owner and the administration as such (no administrator nor
//    conseiller named, no account identifier), the readers' IP addresses and browsers (kept in the
//    administrators' raw journal only: the readers consented to nothing more than the measure they
//    are told about), what an AI application was asked to do, security traces (refused or requested
//    accesses, rate limits), investors' readings through pools, their marks of interest, pledges and
//    consents (their own views, E07.05–E07.07), the structures' follow-up and internal notes (the
//    candidature's views, E06), anything about other requests.
//  * The owner's alone: neither a share's recipient, nor a pool's investors, nor the workspaces'
//    conseillers or managers, nor an administrator through this route (they keep the raw journal).

export const OWNER_HISTORY_PAGE_SIZE = 20

export const ownerHistoryFilterSchema = z.enum([
  'all',
  'consultations',
  'access',
  'administration',
  'request',
])
export type OwnerHistoryFilter = z.infer<typeof ownerHistoryFilterSchema>

export const OWNER_HISTORY_FILTER_LABELS: Record<OwnerHistoryFilter, string> = {
  all: 'Tout',
  consultations: 'Consultations',
  access: 'Accès',
  administration: 'Administration',
  request: 'Votre demande',
}

// `GET /v1/dossiers/:id/history?filter=&page=`, both optional (`all`, page 1; past the last, no item).
export const ownerHistoryQuerySchema = z
  .object({
    filter: ownerHistoryFilterSchema.optional(),
    page: z.coerce
      .number({ message: 'Page invalide.' })
      .int('Page invalide.')
      .min(1, 'Page invalide.')
      .max(500, 'Page invalide.')
      .optional(),
  })
  .strict()
export type OwnerHistoryQuery = z.infer<typeof ownerHistoryQuerySchema>

export const ownerHistoryKindSchema = z.enum([
  'consultation',
  'share_created',
  'share_level_changed',
  'share_revoked',
  'answer_edited',
  'classification_updated',
  'document_added',
  'request_submitted',
  'request_published',
  'request_unpublished',
  'request_archived',
  'request_unarchived',
])
export type OwnerHistoryKind = z.infer<typeof ownerHistoryKindSchema>

// One entry: what happened (`summary`, a French sentence without its date) and when; `details`, French
// label/value pairs (levels, values before and after); `recipientEmail` for an entry about a share;
// `consultation` for a view — its page, last activity and active time (`null`: not measured, taken
// before E07.08).
export const ownerHistoryEntrySchema = z.object({
  kind: ownerHistoryKindSchema,
  occurredAt: z.string().datetime(),
  byAdministration: z.boolean(),
  summary: z.string(),
  recipientEmail: z.string().nullable(),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  consultation: z
    .object({
      channel: readingChannelSchema,
      lastSeenAt: z.string().datetime(),
      activeSeconds: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
})
export type OwnerHistoryEntry = z.infer<typeof ownerHistoryEntrySchema>

export const ownerHistoryPageSchema = z.object({
  filter: ownerHistoryFilterSchema,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  items: z.array(ownerHistoryEntrySchema),
})
export type OwnerHistoryPage = z.infer<typeof ownerHistoryPageSchema>
