import { z } from 'zod'
import { COMPANY_NAME_MAX_LENGTH } from './company.schema.js'
import {
  PARTICIPATION_FORM_TIMING,
  PARTICIPATION_HONEYPOT_FIELD,
  PARTICIPATION_REQUEST_LIMITS,
  PARTICIPATION_REQUEST_RECEIVED,
} from './participation-request.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'
import { memberPersonSchema } from './workspace-member.schema.js'

// ROADMAP E09.05: an entrepreneur without a Confluent account asks a workspace, from its public page
// (`/w/<slug>/candidater`, no sign-in), for access to its candidature path: their name, their
// company's (or project's) name, their email and a message. Confluent opens no general sign-up:
// accounts are still created on a decision of someone entitled to — here, the workspace's managers.
//
// When the form is offered: only while the workspace's public page is published, its « apply » block
// shown and a candidature form published (E05.09) — exactly when the page shows how to apply. Any
// other workspace, or none under that slug, answers alike (`404`).
//
// What a request is: a pending request in the workspace's queue, nothing else — no account, no right,
// no email sent; it is linked to no account even if the address is one's. One pending request per
// address and workspace: a new submission while one is pending is counted on it and keeps what it
// said first.
//
// The decision — the workspace's managers (and Confluent's administrators) only, once
// (`accepted`/`refused`, final; a refused person may send the form again, a new pending request):
//  * accepted: the address's account is created when unknown, as an entrepreneur's (the role that
//    owns companies and presents requests), unverified until its first sign-in; an existing account
//    that may own companies is kept as it is (never role-changed); an account that may not — an
//    investor's, a deactivated one — is not changed either: the acceptance is refused (`409`) and the
//    managers refuse the request or have an administrator look at the account. Nothing is created on
//    the person's behalf (no company, no request, no candidature): an email invites them to sign in
//    and present their request to the workspace. Accepting needs the workspace to receive
//    candidatures still (`409` otherwise).
//  * refused: nothing created, no email.
//
// Anti-abuse, as the participation form's (E08.04): a form token signed by the API (for this form
// only), refused when sent too soon or too late; the hidden field robots fill; rate limits per
// network address and per address; bounded fields; a queue capped per workspace. The answer is the
// same whether the address is known, already pending or silently set aside.
//
// The closed lists and limits are kept equal to the CHECK constraints of migration
// 20261211000000_entrepreneur_access_requests.

export const ENTREPRENEUR_ACCESS_REQUEST_STATUSES = ['pending', 'accepted', 'refused'] as const
export const entrepreneurAccessRequestStatusSchema = z.enum(ENTREPRENEUR_ACCESS_REQUEST_STATUSES)
export type EntrepreneurAccessRequestStatus = z.infer<typeof entrepreneurAccessRequestStatusSchema>

export const ENTREPRENEUR_ACCESS_REQUEST_STATUS_LABELS: Record<
  EntrepreneurAccessRequestStatus,
  string
> = {
  pending: 'À traiter',
  accepted: 'Acceptée',
  refused: 'Refusée',
}

export const ENTREPRENEUR_ACCESS_DECISIONS = ['accepted', 'refused'] as const
export const entrepreneurAccessDecisionSchema = z.enum(ENTREPRENEUR_ACCESS_DECISIONS, {
  message: 'Décision inconnue : acceptée ou refusée.',
})
export type EntrepreneurAccessDecision = z.infer<typeof entrepreneurAccessDecisionSchema>

// What an acceptance did to the address's account.
export const ENTREPRENEUR_ACCESS_ADMISSIONS = ['account_created', 'account_existing'] as const
export type EntrepreneurAccessAdmission = (typeof ENTREPRENEUR_ACCESS_ADMISSIONS)[number]
export const ENTREPRENEUR_ACCESS_ADMISSION_LABELS: Record<EntrepreneurAccessAdmission, string> = {
  account_created: 'Compte porteur de projet créé',
  account_existing: 'Compte existant, inchangé',
}

// The email inviting an accepted person: to be sent once the decision is recorded, then sent or
// failed (the decision stands either way; the person can still sign in with their address).
export const ENTREPRENEUR_ACCESS_INVITATION_EMAIL_STATUSES = ['to_send', 'sent', 'failed'] as const
export type EntrepreneurAccessInvitationEmailStatus =
  (typeof ENTREPRENEUR_ACCESS_INVITATION_EMAIL_STATUSES)[number]

export const ENTREPRENEUR_ACCESS_REQUEST_LIMITS = {
  name: PARTICIPATION_REQUEST_LIMITS.name,
  // The bound of a company's name (`companies_name_check`).
  companyName: COMPANY_NAME_MAX_LENGTH,
  email: PARTICIPATION_REQUEST_LIMITS.email,
  message: PARTICIPATION_REQUEST_LIMITS.message,
  pendingPerWorkspace: PARTICIPATION_REQUEST_LIMITS.pendingPerWorkspace,
  decidedListed: PARTICIPATION_REQUEST_LIMITS.decidedListed,
  formToken: PARTICIPATION_REQUEST_LIMITS.formToken,
  honeypot: PARTICIPATION_REQUEST_LIMITS.honeypot,
} as const

// Same timing and hidden field as the participation form.
export const ENTREPRENEUR_ACCESS_FORM_TIMING = PARTICIPATION_FORM_TIMING
export const ENTREPRENEUR_ACCESS_HONEYPOT_FIELD = PARTICIPATION_HONEYPOT_FIELD
// The answer to every accepted submission — recorded, merged or set aside alike.
export const ENTREPRENEUR_ACCESS_REQUEST_RECEIVED = PARTICIPATION_REQUEST_RECEIVED

// The public page of the form: who receives it, and the token to send back.
export const entrepreneurAccessFormSchema = z
  .object({
    workspace: z.object({ name: z.string(), programName: z.string().nullable() }).strict(),
    formToken: z.string(),
  })
  .strict()
export type EntrepreneurAccessForm = z.infer<typeof entrepreneurAccessFormSchema>

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()
const blankToNull = (v: string) => (v === '' ? null : v)

const requiredLine = (max: number, missing: string, tooLong: string) =>
  z
    .string({ message: missing })
    .transform(oneLine)
    .pipe(z.string().min(1, missing).max(max, tooLong))

export const createEntrepreneurAccessRequestSchema = z
  .object({
    name: requiredLine(
      ENTREPRENEUR_ACCESS_REQUEST_LIMITS.name,
      'Indiquez votre nom.',
      `Le nom compte au plus ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.name} caractères.`,
    ),
    companyName: requiredLine(
      ENTREPRENEUR_ACCESS_REQUEST_LIMITS.companyName,
      'Indiquez le nom de votre entreprise ou de votre projet.',
      `Le nom de l’entreprise compte au plus ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.companyName} caractères.`,
    ),
    // Compared and kept in lower case.
    email: z
      .string({ message: 'Indiquez votre adresse email.' })
      .trim()
      .toLowerCase()
      .max(ENTREPRENEUR_ACCESS_REQUEST_LIMITS.email, 'L’adresse email est trop longue.')
      .email('L’adresse email n’est pas valide.'),
    message: z
      .string()
      .transform(plainParagraphs)
      .pipe(
        z
          .string()
          .max(
            ENTREPRENEUR_ACCESS_REQUEST_LIMITS.message,
            `Le message compte au plus ${ENTREPRENEUR_ACCESS_REQUEST_LIMITS.message} caractères.`,
          )
          .refine((v) => !HTML_TAG.test(v), {
            message: 'Le message est un texte simple : les balises HTML ne sont pas acceptées.',
          }),
      )
      .transform(blankToNull)
      .nullable()
      .optional(),
    formToken: z.string().max(ENTREPRENEUR_ACCESS_REQUEST_LIMITS.formToken),
    [ENTREPRENEUR_ACCESS_HONEYPOT_FIELD]: z
      .string()
      .max(ENTREPRENEUR_ACCESS_REQUEST_LIMITS.honeypot)
      .optional(),
  })
  .strict()
export type CreateEntrepreneurAccessRequestInput = z.input<
  typeof createEntrepreneurAccessRequestSchema
>

export const decideEntrepreneurAccessRequestSchema = z
  .object({
    decision: entrepreneurAccessDecisionSchema,
    // The version the manager read (`409` when the request changed since).
    version: z.number({ message: 'Version manquante.' }).int().min(1),
  })
  .strict()
export type DecideEntrepreneurAccessRequestInput = z.input<
  typeof decideEntrepreneurAccessRequestSchema
>

// The queue: pending requests (oldest first), or decided ones (latest decision first, at most
// `decidedListed`).
export const ENTREPRENEUR_ACCESS_REQUEST_LISTS = ['pending', 'decided'] as const
export const listEntrepreneurAccessRequestsQuerySchema = z
  .object({ status: z.enum(ENTREPRENEUR_ACCESS_REQUEST_LISTS).default('pending') })
  .strict()
export type ListEntrepreneurAccessRequestsQuery = z.input<
  typeof listEntrepreneurAccessRequestsQuerySchema
>

// A request as the workspace's managers read it.
export const entrepreneurAccessRequestSchema = z.object({
  id: z.string().uuid(),
  status: entrepreneurAccessRequestStatusSchema,
  name: z.string(),
  companyName: z.string(),
  email: z.string(),
  message: z.string().nullable(),
  submissionCount: z.number().int().min(1),
  lastSubmittedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  version: z.number().int().min(1),
  decidedAt: z.string().datetime().nullable(),
  decidedBy: memberPersonSchema.nullable(),
  admission: z.enum(ENTREPRENEUR_ACCESS_ADMISSIONS).nullable(),
  invitationEmail: z.enum(ENTREPRENEUR_ACCESS_INVITATION_EMAIL_STATUSES).nullable(),
  invitationEmailAt: z.string().datetime().nullable(),
})
export type EntrepreneurAccessRequest = z.infer<typeof entrepreneurAccessRequestSchema>

// The answer to a decision: the request as decided, and whether the invitation email left (null
// when none was due: a refusal, or a decision already taken that this call only repeated).
export const entrepreneurAccessDecisionResultSchema = z.object({
  request: entrepreneurAccessRequestSchema,
  invitationEmailSent: z.boolean().nullable(),
})
export type EntrepreneurAccessDecisionResult = z.infer<
  typeof entrepreneurAccessDecisionResultSchema
>

// What a manager is told once a decision is answered: from what this call did — and, for an
// acceptance this call only repeated, from the email's recorded state. Never an email announced that
// did not leave (code review R68).
export function entrepreneurAccessDecisionNotice(
  name: string,
  decision: EntrepreneurAccessDecision,
  result: Pick<EntrepreneurAccessDecisionResult, 'invitationEmailSent'> & {
    request: Pick<EntrepreneurAccessRequest, 'invitationEmail'>
  },
): { tone: 'success' | 'warning' | 'info'; text: string } {
  if (decision === 'refused') return { tone: 'success', text: `Demande de ${name} refusée.` }
  const cannotLeave = 'la personne peut se connecter avec son adresse depuis la page de connexion.'
  if (result.invitationEmailSent === true) {
    return {
      tone: 'success',
      text: `Demande de ${name} acceptée : la personne est invitée par email à présenter sa demande.`,
    }
  }
  if (result.invitationEmailSent === false) {
    return {
      tone: 'warning',
      text: `Demande de ${name} acceptée, mais l’email n’a pas pu partir : ${cannotLeave}`,
    }
  }
  switch (result.request.invitationEmail) {
    case 'sent':
      return {
        tone: 'info',
        text: `La demande de ${name} était déjà acceptée ; la personne a été invitée par email.`,
      }
    case 'failed':
      return {
        tone: 'warning',
        text: `La demande de ${name} était déjà acceptée, mais l’email n’a pas pu partir : ${cannotLeave}`,
      }
    default:
      return {
        tone: 'info',
        text: `La demande de ${name} était déjà acceptée ; l’envoi de l’email n’est pas confirmé.`,
      }
  }
}
