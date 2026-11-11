import { z } from 'zod'
import { answerProvenanceSchema, answerRevisionSchema } from './answer.schema.js'
import { eligibilityBadgeSchema } from './eligibility.schema.js'
import { financingTypeSchema } from './financing.schema.js'
import {
  dossierPublicationStatusSchema,
  financingStatusChangeSchema,
  financingStatusSchema,
  receivedFinancingStatusChangeSchema,
} from './status.schema.js'
import { activeQuestionnaireSchema, type FieldType } from './questionnaire.schema.js'

// ROADMAP E05.09, decision D01: a company keeps ONE common profile, presented as is to every
// structure, and each workspace adds its own complementary form. A candidature (glossary:
// « Candidature au workspace ») is one financing request (dossier) presented to one workspace: it
// answers that workspace's complementary form, and those answers are the candidature's own — never
// shown to another workspace, to the recipients of the dossier's shares, nor reused by another
// candidature. Once sent, it carries the request's financing status in that workspace (E06.01,
// status.schema.ts); its accompaniment and committee workflow come with E06/E08.

// Who reads the candidatures a workspace receives: its active conseillers (the right to manage the
// workspace is not required), and Confluent administrators. Closed by default: an investisseur, an
// unknown role or no membership read none — a workspace's investors never see a dossier by mere
// membership (E05, E07). The API resolves the membership at each request; the site only offers
// the screens.
export function canReviewCandidatures(
  actor: { role: string },
  membership: { role: string } | null,
): boolean {
  return actor.role === 'admin' || (membership !== null && membership.role === 'conseiller')
}

// A workspace's forms hold no attachment: documents stay in the company's library (E05.06) and are
// chosen per request, never deposited for one structure.
export function fieldTypeAllowedInWorkspaceForms(fieldType: FieldType): boolean {
  return fieldType !== 'file'
}

// Derived from `submittedAt`: a draft is the owner's alone; once submitted, the workspace reads it
// and its financing status (`financingStatus`) follows the structure's decisions.
export const CANDIDATURE_STATUSES = ['draft', 'submitted'] as const
export const candidatureStatusSchema = z.enum(CANDIDATURE_STATUSES)
export type CandidatureStatus = z.infer<typeof candidatureStatusSchema>

export const CANDIDATURE_STATUS_LABELS: Record<CandidatureStatus, string> = {
  draft: 'Brouillon',
  submitted: 'Envoyée',
}

export const createCandidatureSchema = z
  .object({ workspaceId: z.string().uuid('Choisissez une structure.') })
  .strict()

// A workspace an entrepreneur may present a request to: one with a published complementary form
// assigned to candidatures. Its public identity only.
export const candidatureWorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  programName: z.string().nullable(),
  color: z.string().nullable(),
  presentation: z.string().nullable(),
})

// One answer to the complementary form, as its owner reads it (provenance and history, E04.04/E04.05).
export const candidatureAnswerSchema = z.object({
  id: z.string().uuid(),
  candidatureId: z.string().uuid(),
  fieldId: z.string().uuid(),
  value: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provenance: answerProvenanceSchema.nullable().optional(),
  history: z.array(answerRevisionSchema).optional(),
})

// A candidature as its owner lists it under a request.
export const candidatureSummarySchema = z.object({
  id: z.string().uuid(),
  dossierId: z.string().uuid(),
  workspace: candidatureWorkspaceSchema.pick({ id: true, name: true, programName: true }),
  status: candidatureStatusSchema,
  submittedAt: z.string().datetime().nullable(),
  // E06.01: `preparing` while a draft; changes only once sent.
  financingStatus: financingStatusSchema,
  financingStatusChangedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// The version of the complementary form a candidature answers: the one published when it was
// created, kept afterwards (E03.08).
export const candidatureFormSchema = activeQuestionnaireSchema.extend({ name: z.string() })

// What the owner reads of a candidature.
export const candidatureSchema = candidatureSummarySchema.extend({
  workspace: candidatureWorkspaceSchema,
  dossier: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    // The common profile is complete once submitted through this request (E03.10).
    profileSubmitted: z.boolean(),
  }),
  form: candidatureFormSchema,
  answers: z.array(candidatureAnswerSchema),
  // Every change of the financing status, the latest first.
  statusHistory: z.array(financingStatusChangeSchema),
})

// A value as the workspace reads it: no provenance, no history.
export const receivedAnswerSchema = z.object({ fieldId: z.string().uuid(), value: z.string() })

const applicantSchema = z.object({
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})

// A submitted candidature, as the workspace's conseillers list it.
export const receivedCandidatureSummarySchema = z.object({
  id: z.string().uuid(),
  submittedAt: z.string().datetime(),
  financingStatus: financingStatusSchema,
  financingStatusChangedAt: z.string().datetime(),
  company: z.object({ name: z.string() }),
  dossier: z.object({
    name: z.string(),
    amountEur: z.number().int().nullable(),
    financingTypes: z.array(financingTypeSchema),
  }),
})

// E06.05: in the workspace's list, each candidature's eligibilities to its schemes (in the order of
// the schemes), declarative information — no tax amount.
export const receivedCandidatureListItemSchema = receivedCandidatureSummarySchema.extend({
  eligibilities: z.array(eligibilityBadgeSchema),
})

// E06.05 (and E06.01's status): the filters of that list, each optional, combined with AND. `scheme`:
// eligible to that scheme of the workspace (any other id matches nothing); `verified`: only
// eligibilities the workspace verified (to `scheme`, or to any scheme without it);
// `financingStatus`: the status in this workspace.
export const receivedCandidaturesQuerySchema = z
  .object({
    scheme: z.string().uuid('Dispositif inconnu.').optional(),
    verified: z
      .enum(['true', 'false'], { message: 'Indiquez true ou false.' })
      .transform((v) => v === 'true')
      .optional(),
    financingStatus: financingStatusSchema.optional(),
  })
  .strict()

// A submitted candidature, as the workspace's conseillers read it: the request's presentation, the
// common profile (attachments aside) and the candidature's own answers.
export const receivedCandidatureSchema = receivedCandidatureSummarySchema.extend({
  applicant: applicantSchema,
  dossier: z.object({
    name: z.string(),
    summary: z.string().nullable(),
    objective: z.string().nullable(),
    description: z.string().nullable(),
    amountEur: z.number().int().nullable(),
    financingTypes: z.array(financingTypeSchema),
    publicationStatus: dossierPublicationStatusSchema,
  }),
  profile: activeQuestionnaireSchema.extend({ answers: z.array(receivedAnswerSchema) }),
  form: candidatureFormSchema.extend({ answers: z.array(receivedAnswerSchema) }),
  // Every change of the financing status, the latest first, with who made it.
  statusHistory: z.array(receivedFinancingStatusChangeSchema),
})

export type CreateCandidatureInput = z.infer<typeof createCandidatureSchema>
export type CandidatureWorkspace = z.infer<typeof candidatureWorkspaceSchema>
export type CandidatureAnswer = z.infer<typeof candidatureAnswerSchema>
export type CandidatureSummary = z.infer<typeof candidatureSummarySchema>
export type CandidatureForm = z.infer<typeof candidatureFormSchema>
export type Candidature = z.infer<typeof candidatureSchema>
export type ReceivedAnswer = z.infer<typeof receivedAnswerSchema>
export type ReceivedCandidatureSummary = z.infer<typeof receivedCandidatureSummarySchema>
export type ReceivedCandidatureListItem = z.infer<typeof receivedCandidatureListItemSchema>
export type ReceivedCandidaturesQuery = z.input<typeof receivedCandidaturesQuerySchema>
export type ReceivedCandidature = z.infer<typeof receivedCandidatureSchema>
