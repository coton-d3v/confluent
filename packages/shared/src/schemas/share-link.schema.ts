import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'
import { documentGroupSchema } from './document.schema.js'
import { dossierSchema } from './dossier.schema.js'
import { questionnaireFieldSchema, questionnaireSectionSchema } from './questionnaire.schema.js'

export const shareLinkStatusSchema = z.enum(['pending', 'active', 'revoked', 'expired'])

export const shareLinkSchema = z.object({
  id: z.string().uuid(),
  dossierId: z.string().uuid(),
  recipientEmail: z.string().email(),
  token: z.string().uuid(),
  status: shareLinkStatusSchema,
  accessLevel: accessLevelSchema.default('complet'),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
})

export const shareLinkWithUrlSchema = shareLinkSchema.extend({
  shareUrl: z.string().min(1),
})

// E02.08: the visitor of a share link states who they are; a sign-in link is sent only if this is
// the recipient's address (no oracle: the answer is the same either way).
export const shareAccessRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
})

// E07.01: the owner chooses the level of each invitation; none is assumed.
export const createShareLinkSchema = z.object({
  recipientEmail: z.string().trim().toLowerCase().email(),
  accessLevel: accessLevelSchema,
})

// E07.01: the owner changes the level of an active share; the recipient keeps the same link.
export const updateShareLinkSchema = z.object({
  accessLevel: accessLevelSchema,
})

// Who revoked a share: the request's owner, or an administrator (E07.01).
export const shareRevokedBySchema = z.enum(['owner', 'admin'])

// One entry of the list of accesses, as its owner and administrators read it.
export const shareAccessSchema = shareLinkSchema.extend({
  revokedBy: shareRevokedBySchema.nullable(),
})

// What the recipient of a share reads, already filtered server-side by its level: `fields`/`answers`
// only contain fields the level may read, `documents` only lists the documents the dossier selects
// (E05.07), at the version selected, among those the level may read (an attachment follows its
// field, any other document requires `complet`). One projection on the server builds it, for the
// recipient and for the preview « Voir comme le destinataire » (E07.01).
export const recipientViewSchema = z.object({
  dossier: dossierSchema.pick({
    id: true,
    name: true,
    slug: true,
    sector: true,
    maturityStage: true,
    ancrageCvl: true,
    tagTechnologique: true,
    axe1Projet: true,
    axe2Financier: true,
    axe3Origine: true,
    deeptechScore: true,
    preCreation: true,
    // E05.07: the request's presentation, empty while it is a draft.
    summary: true,
    objective: true,
    description: true,
    amountEur: true,
    financingTypes: true,
    publicationStatus: true,
    publishedAt: true,
  }),
  sections: z.array(questionnaireSectionSchema),
  fields: z.array(questionnaireFieldSchema),
  answers: z.array(z.object({ fieldId: z.string().uuid(), value: z.string() })),
  documents: z.array(documentGroupSchema),
})

// What a financeur sees through a share link: the recipient's view at the level of this very link.
export const financeurShareResponseSchema = recipientViewSchema.extend({
  share: z.object({
    recipientEmail: z.string().email(),
    status: shareLinkStatusSchema,
    accessLevel: accessLevelSchema,
  }),
})

export const sharePreviewQuerySchema = z.object({
  level: accessLevelSchema,
})

// E07.01 « Voir comme le destinataire »: exactly what a recipient at `preview.accessLevel` would read,
// for the owner and administrators, without any link nor any view recorded. A preview delivers no
// file: each version's `url` is null, its `availability` is the recipient's.
export const sharePreviewSchema = recipientViewSchema.extend({
  preview: z.object({
    accessLevel: accessLevelSchema,
    // Everything the request could show: the questions of its profile's version and the documents
    // it selects, whatever their level.
    totalQuestions: z.number().int().nonnegative(),
    totalDocuments: z.number().int().nonnegative(),
  }),
})

export type ShareLinkStatus = z.infer<typeof shareLinkStatusSchema>
export type ShareLink = z.infer<typeof shareLinkSchema>
export type ShareLinkWithUrl = z.infer<typeof shareLinkWithUrlSchema>
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>
export type UpdateShareLinkInput = z.infer<typeof updateShareLinkSchema>
export type ShareRevokedBy = z.infer<typeof shareRevokedBySchema>
export type ShareAccess = z.infer<typeof shareAccessSchema>
export type RecipientView = z.infer<typeof recipientViewSchema>
export type SharePreview = z.infer<typeof sharePreviewSchema>
export type ShareAccessRequest = z.infer<typeof shareAccessRequestSchema>
export type FinanceurShareResponse = z.infer<typeof financeurShareResponseSchema>
