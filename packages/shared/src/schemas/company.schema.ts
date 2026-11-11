import { z } from 'zod'
import { companyOwnerEmailSchema, companyPreparationSchema } from './company-transfer.schema.js'
import { financingTypeSchema } from './financing.schema.js'
import { dossierPublicationStatusSchema } from './status.schema.js'

// Companies (ROADMAP E05.04): the company an entrepreneur presents, owner of the common profile and,
// from E05.06, of the document library; its financing dossiers are attached to it. Since E05.05 the
// profile's answers and documents are the company's, presented by each of its dossiers. Since
// E05.07 a company makes several financing requests (its dossiers), each created on its page
// without entering the profile again.

// The single rule of who may own a company, hence its financing dossiers: an entrepreneur, or an
// administrator (who could already create dossiers). Closed by default: any other global role,
// including one unknown to this code, owns nothing; a workspace membership never grants it. The API
// enforces it; the site uses it only to offer creation.
export function canOwnCompanies(user: { role: string }): boolean {
  return user.role === 'entrepreneur' || user.role === 'admin'
}

// Same bounds as a dossier name (the company of a new dossier is named after it) and as the
// `companies_name_check` constraint.
export const COMPANY_NAME_MAX_LENGTH = 200

export const companySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(COMPANY_NAME_MAX_LENGTH),
  // E05.08: true while a conseiller holds the company for an entrepreneur (given to that conseiller
  // only): it can then be neither shared nor published.
  inPreparation: z.boolean().optional(),
})

// E05.08: a company a conseiller prepares in a workspace for an entrepreneur, with its first
// financing request (named after it), and the invitation sent to that entrepreneur.
export const prepareCompanySchema = z
  .object({
    companyName: z
      .string()
      .trim()
      .min(1, 'Le nom de l’entreprise est obligatoire.')
      .max(
        COMPANY_NAME_MAX_LENGTH,
        `Le nom de l’entreprise compte au plus ${COMPANY_NAME_MAX_LENGTH} caractères.`,
      ),
    ownerEmail: companyOwnerEmailSchema,
  })
  .strict()

// A financing dossier (request) as listed under its company, with what tells it apart (E05.07).
export const companyDossierSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string(),
  summary: z.string().nullable(),
  amountEur: z.number().int().nullable(),
  financingTypes: z.array(financingTypeSchema),
  publicationStatus: dossierPublicationStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

// What the owner reads of their company. No owner identifier: only the owner reads it.
export const companySchema = companySummarySchema.omit({ inPreparation: true }).extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dossiers: z.array(companyDossierSchema),
  // E05.08: null for a company of its own; for a company a conseiller holds for an entrepreneur,
  // the workspace it is prepared in and its latest invitation.
  preparation: companyPreparationSchema.nullable(),
})

export type CompanySummary = z.infer<typeof companySummarySchema>
export type CompanyDossier = z.infer<typeof companyDossierSchema>
export type Company = z.infer<typeof companySchema>
export type PrepareCompanyInput = z.input<typeof prepareCompanySchema>
