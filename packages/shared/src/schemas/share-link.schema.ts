import { z } from 'zod'
import { accessLevelSchema } from './access-level.schema.js'
import { documentGroupSchema } from './document.schema.js'
import { dossierSchema } from './dossier.schema.js'
import { questionnaireFieldSchema } from './questionnaire.schema.js'

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

export const createShareLinkSchema = z.object({
  recipientEmail: z.string().trim().toLowerCase().email(),
  accessLevel: accessLevelSchema.optional(),
})

// What a financeur sees through a share link, already filtered server-side by `share.accessLevel`:
// `fields`/`answers` only contain fields the level may read, `documents` is null below `complet`.
export const financeurShareResponseSchema = z.object({
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
  }),
  share: z.object({
    recipientEmail: z.string().email(),
    status: shareLinkStatusSchema,
    accessLevel: accessLevelSchema,
  }),
  fields: z.array(questionnaireFieldSchema),
  answers: z.array(z.object({ fieldId: z.string().uuid(), value: z.string() })),
  documents: z.array(documentGroupSchema).nullable(),
})

export type ShareLinkStatus = z.infer<typeof shareLinkStatusSchema>
export type ShareLink = z.infer<typeof shareLinkSchema>
export type ShareLinkWithUrl = z.infer<typeof shareLinkWithUrlSchema>
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>
export type FinanceurShareResponse = z.infer<typeof financeurShareResponseSchema>
