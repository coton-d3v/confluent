import { z } from 'zod'

// Companies (ROADMAP E05.04): the company an entrepreneur presents, owner of the common profile and,
// from E05.06, of the document library; its financing dossiers are attached to it. Since E05.05 the
// profile's answers and documents are the company's, presented by each of its dossiers; until
// E05.07 each new dossier still comes with its own company.

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
})

// A financing dossier as listed under its company.
export const companyDossierSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

// What the owner reads of their company. No owner identifier: only the owner reads it.
export const companySchema = companySummarySchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dossiers: z.array(companyDossierSchema),
})

export type CompanySummary = z.infer<typeof companySummarySchema>
export type CompanyDossier = z.infer<typeof companyDossierSchema>
export type Company = z.infer<typeof companySchema>
