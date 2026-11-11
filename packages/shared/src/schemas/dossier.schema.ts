import { z } from 'zod';
import { COMPANY_NAME_MAX_LENGTH, companySummarySchema } from './company.schema.js';
import {
  dossierNameSchema,
  dossierPresentationShape,
  financingTypeSchema,
} from './financing.schema.js';
import { dossierPublicationStatusSchema } from './status.schema.js';

export const dossierSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  // The company the dossier finances (E05.04); `company` is given to its owner only.
  companyId: z.string().uuid(),
  company: companySummarySchema.optional(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1),
  questionnaireVersionId: z.string().uuid(),
  sector: z.string().nullable(),
  maturityStage: z.string().nullable(),
  ancrageCvl: z.string().nullable(),
  tagTechnologique: z.string().nullable(),
  axe1Projet: z.number().int().nullable(),
  axe2Financier: z.number().int().nullable(),
  axe3Origine: z.number().int().nullable(),
  deeptechScore: z.number().int().nullable(),
  preCreation: z.boolean().nullable(),
  submittedAt: z.string().datetime().nullable(),
  // E05.07: the request's presentation. The recipients of a share see it once the request is
  // published (null and [] while it is a draft); its owner and administrators always do.
  summary: z.string().nullable(),
  objective: z.string().nullable(),
  description: z.string().nullable(),
  amountEur: z.number().int().nullable(),
  financingTypes: z.array(financingTypeSchema),
  publicationStatus: dossierPublicationStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  // E06.01: set exactly while the request is archived.
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().optional(),
});

// A new dossier of a new company, named after it (E05.04).
export const createDossierSchema = z.object({
  name: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH),
});

// E05.07: another financing request of an existing company, which presents the same profile.
export const createCompanyDossierSchema = z.object({ name: dossierNameSchema }).strict();

// The title (`name`) and the presentation of a request (E05.07); null clears an optional part.
// Unknown keys are refused rather than ignored (publication has its own routes).
export const updateDossierSchema = z
  .object({ name: dossierNameSchema.optional(), ...dossierPresentationShape })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided.',
  });

export const adminDossierListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  sector: z.string().nullable(),
  maturityStage: z.string().nullable(),
  tagTechnologique: z.string().nullable(),
  ownerEmail: z.string().email(),
  companyName: z.string(),
  publicationStatus: dossierPublicationStatusSchema,
  createdAt: z.string().datetime(),
  activeShareLinksCount: z.number().int().nonnegative(),
});

export const adminDossierListSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(adminDossierListItemSchema),
});

export type Dossier = z.infer<typeof dossierSchema>;
export type CreateDossierInput = z.infer<typeof createDossierSchema>;
export type CreateCompanyDossierInput = z.infer<typeof createCompanyDossierSchema>;
export type UpdateDossierInput = z.input<typeof updateDossierSchema>;
export type AdminDossierListItem = z.infer<typeof adminDossierListItemSchema>;
export type AdminDossierList = z.infer<typeof adminDossierListSchema>;
