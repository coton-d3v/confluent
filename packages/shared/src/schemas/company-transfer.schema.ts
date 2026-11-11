import { z } from 'zod'

// ROADMAP E05.08: a conseiller prepares a company for an entrepreneur within a workspace, invites
// them to take it over, and the entrepreneur accepts or declines its ownership. Until then the
// conseiller holds the company (its owner, for the workspace); accepting transfers it, with all its
// financing requests, profile and library, to the entrepreneur.

// `pending` → `accepted` | `declined`; `cancelled`: withdrawn or replaced by the conseiller;
// `expired`: replaced after its validity. The database repeats the list in a CHECK constraint.
export const COMPANY_TRANSFER_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
] as const
export type CompanyTransferStatus = (typeof COMPANY_TRANSFER_STATUSES)[number]

export const COMPANY_TRANSFER_STATUS_LABELS: Record<CompanyTransferStatus, string> = {
  pending: 'En attente de réponse',
  accepted: 'Acceptée',
  declined: 'Refusée',
  cancelled: 'Retirée',
  expired: 'Expirée',
}

// How long an invitation can be answered; the conseiller may send a new one afterwards.
export const COMPANY_TRANSFER_VALIDITY_DAYS = 30

// Who prepares companies for entrepreneurs in a workspace, and works on them until they are taken
// over: its active conseillers — the right to manage the workspace is not required. Closed by
// default: an investisseur, an unknown role or no membership prepare nothing, and neither the
// global role nor being a Confluent administrator does. `membership` is an active one (the API
// resolves it at each request; the site only offers the action).
export function canPrepareCompanies(membership: { role: string } | null): boolean {
  return membership !== null && membership.role === 'conseiller'
}

// The address of the entrepreneur who will own the company; their account is created if unknown.
export const companyOwnerEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'L’adresse email est trop longue.')
  .email('L’adresse email n’est pas valide.')

// A new invitation for a company still held: to another address, or again after a refusal or an
// expiry. It replaces the one waiting for an answer, if any.
export const inviteCompanyOwnerSchema = z.object({ email: companyOwnerEmailSchema }).strict()

const personSchema = z.object({
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})

// An invitation as the conseillers of its workspace and the company's holder see it. `status` is
// `expired` for a pending invitation past `expiresAt`.
export const companyTransferInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  status: z.enum(COMPANY_TRANSFER_STATUSES),
  invitedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
})

// A company prepared in a workspace, as its conseillers list it: still held by one of them, or
// taken over by its entrepreneur (`invitation.status` `accepted`; what it has become is no longer
// the workspace's to see: no holder, no number of requests).
export const preparedCompanySchema = z.object({
  company: z.object({ id: z.string().uuid(), name: z.string() }),
  held: z.boolean(),
  heldByMe: z.boolean(),
  holder: personSchema.nullable(),
  dossierCount: z.number().int().nullable(),
  invitation: companyTransferInvitationSchema,
})

export const preparedCompanyCreatedSchema = z.object({
  preparation: preparedCompanySchema,
  // The first financing request, created with the company (its slug opens it in the site).
  dossier: z.object({ id: z.string().uuid(), slug: z.string() }),
  // False when the invitation email could not be sent: the invitation exists all the same.
  invitationEmailSent: z.boolean(),
})

export const companyInvitationSentSchema = z.object({
  preparation: preparedCompanySchema,
  invitationEmailSent: z.boolean(),
})

// A company offered to the signed-in person, waiting for their answer: what they need to decide,
// nothing of its content before they own it.
export const companyTransferOfferSchema = z.object({
  id: z.string().uuid(),
  company: z.object({ name: z.string() }),
  dossierCount: z.number().int(),
  workspace: z.object({ name: z.string(), programName: z.string().nullable() }),
  from: personSchema.nullable(),
  invitedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})

export const companyTransferDecisionSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  // The company now owned by the person who accepted; null after a refusal.
  companyId: z.string().uuid().nullable(),
})

// What the holder of a prepared company reads of its preparation on the company's page.
export const companyPreparationSchema = z.object({
  workspace: z.object({ id: z.string().uuid(), name: z.string() }),
  invitation: companyTransferInvitationSchema.nullable(),
})

export type InviteCompanyOwnerInput = z.input<typeof inviteCompanyOwnerSchema>
export type CompanyTransferInvitation = z.infer<typeof companyTransferInvitationSchema>
export type PreparedCompany = z.infer<typeof preparedCompanySchema>
export type PreparedCompanyCreated = z.infer<typeof preparedCompanyCreatedSchema>
export type CompanyInvitationSent = z.infer<typeof companyInvitationSentSchema>
export type CompanyTransferOffer = z.infer<typeof companyTransferOfferSchema>
export type CompanyTransferDecision = z.infer<typeof companyTransferDecisionSchema>
export type CompanyPreparation = z.infer<typeof companyPreparationSchema>
