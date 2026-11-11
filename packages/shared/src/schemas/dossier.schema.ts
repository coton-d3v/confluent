import { z } from 'zod';
import { COMPANY_NAME_MAX_LENGTH, companySummarySchema } from './company.schema.js';

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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().optional(),
});

// Until E05.07 a new dossier comes with its own company, named after it.
export const createDossierSchema = z.object({
  name: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH),
});

export const updateDossierSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.name !== undefined, { message: 'At least one field must be provided.' });

export const adminDossierListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  sector: z.string().nullable(),
  maturityStage: z.string().nullable(),
  tagTechnologique: z.string().nullable(),
  ownerEmail: z.string().email(),
  companyName: z.string(),
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
export type UpdateDossierInput = z.infer<typeof updateDossierSchema>;
export type AdminDossierListItem = z.infer<typeof adminDossierListItemSchema>;
export type AdminDossierList = z.infer<typeof adminDossierListSchema>;
