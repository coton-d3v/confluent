import { z } from 'zod'
import {
  committeeStatusOf,
  committeeStatusSchema,
  sharedCommitteeSchema,
  toSharedCommittee,
} from './committee.schema.js'
import type { CommitteeSharedField } from './committee.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'
import {
  WORKSPACE_MEMBER_LIMITS,
  memberPersonSchema,
  type WorkspaceMemberRole,
} from './workspace-member.schema.js'

// ROADMAP E08.04: an investor or any outside person asks to take part in one or more committees of
// a workspace, from a public page (no account, no sign-in): their name, organisation, email, a
// message and the sessions chosen.
//
// What is offered: only the committees a manager of the workspace opened to such requests
// (`participationRequestsOpen`, closed by default), planned and not started yet. What the public
// reads of them: `toPublicCommittee` — their name and when, picked from the shared view of E08.02
// (`toSharedCommittee`); never the place, the meeting link, the shared information (for the
// committee's candidates and investors) nor the internal notes. A workspace offering none answers
// like a workspace that does not exist.
//
// What a request is: a pending request (`pending`) in the workspace's queue, nothing else — no
// account, no membership, no right, no email sent. One pending request per address and workspace: a
// new submission while one is pending adds the sessions chosen to it and keeps what it said first.
//
// ROADMAP E08.05 — the decision. The workspace's managers (and Confluent's administrators) accept or
// refuse a pending request, once (`PARTICIPATION_DECISIONS`, final: `accepted` and `refused` change
// no more; a refused person may send the form again, which makes a new pending request). The
// request keeps who decided and when. Only an acceptance grants anything, and only then: the
// address's account is created when unknown (unverified until its first sign-in, E05.02) and made an
// `investisseur` of the workspace (`PARTICIPATION_MEMBER_ROLE`, with the request's organisation),
// unless it already holds an active membership there, kept as it is (never widened nor narrowed);
// a deactivated membership is not reactivated by a request (refused: reactivating is a members'
// decision). The person is then told by email (`invitationEmail`: recorded, never blocking the
// decision). A refusal sends nothing, grants nothing and creates nothing. Whatever the decision, the
// sessions asked for stay recorded with the request: being accepted gives no access to a committee
// by itself (E08.06 decides what accepted participants read).
//
// Anti-abuse (API side): a form token signed by the API, issued with the public page, refused when
// sent too soon after it (`PARTICIPATION_FORM_TIMING.minFillMs`) or too late; a field hidden from
// people (`PARTICIPATION_HONEYPOT_FIELD`) that only robots fill; rate limits per address and per
// network address; bounded fields. The answer is the same whether the address is known, already
// pending or silently set aside, so the form tells nobody who asked.
//
// The closed lists and limits are kept equal to the CHECK constraints of migrations
// 20261204000000_participation_requests and 20261205000000_participation_decisions.

export const PARTICIPATION_REQUEST_STATUSES = ['pending', 'accepted', 'refused'] as const
export const participationRequestStatusSchema = z.enum(PARTICIPATION_REQUEST_STATUSES)
export type ParticipationRequestStatus = z.infer<typeof participationRequestStatusSchema>

export const PARTICIPATION_REQUEST_STATUS_LABELS: Record<ParticipationRequestStatus, string> = {
  pending: 'À traiter',
  accepted: 'Acceptée',
  refused: 'Refusée',
}

// E08.05: what a manager decides of a pending request.
export const PARTICIPATION_DECISIONS = ['accepted', 'refused'] as const
export const participationDecisionSchema = z.enum(PARTICIPATION_DECISIONS, {
  message: 'Décision inconnue : acceptée ou refusée.',
})
export type ParticipationDecision = z.infer<typeof participationDecisionSchema>

// The role an accepted request gives an address that is not yet a member of the workspace.
export const PARTICIPATION_MEMBER_ROLE = 'investisseur' as const satisfies WorkspaceMemberRole

// What an acceptance did: created the account and its membership, added an existing account to
// the workspace, or found it already an active member (its membership kept as it was).
export const PARTICIPATION_ADMISSIONS = [
  'account_created',
  'membership_created',
  'already_member',
] as const
export type ParticipationAdmission = (typeof PARTICIPATION_ADMISSIONS)[number]
export const PARTICIPATION_ADMISSION_LABELS: Record<ParticipationAdmission, string> = {
  account_created: 'Compte créé, ajouté comme investisseur',
  membership_created: 'Compte existant, ajouté comme investisseur',
  already_member: 'Déjà membre du workspace : accès inchangé',
}

// The email telling an accepted person: to be sent once the decision is recorded, then sent or
// failed (the decision stands either way; the person can still sign in with their address).
export const PARTICIPATION_INVITATION_EMAIL_STATUSES = ['to_send', 'sent', 'failed'] as const
export type ParticipationInvitationEmailStatus =
  (typeof PARTICIPATION_INVITATION_EMAIL_STATUSES)[number]

export const decideParticipationRequestSchema = z
  .object({
    decision: participationDecisionSchema,
    // The version the manager read (`409` when the request changed since — a new submission added
    // sessions, another manager decided).
    version: z.number({ message: 'Version manquante.' }).int().min(1),
  })
  .strict()
export type DecideParticipationRequestInput = z.input<typeof decideParticipationRequestSchema>

// The queue: pending requests (oldest first), or decided ones (latest decision first, at most
// `decidedListed`); optionally only those asking for one committee.
export const PARTICIPATION_REQUEST_LISTS = ['pending', 'decided'] as const
export const listParticipationRequestsQuerySchema = z
  .object({
    status: z.enum(PARTICIPATION_REQUEST_LISTS).default('pending'),
    committeeId: z.string().uuid('Comité inconnu.').optional(),
  })
  .strict()
export type ListParticipationRequestsQuery = z.input<typeof listParticipationRequestsQuerySchema>

export const PARTICIPATION_REQUEST_LIMITS = {
  name: 120,
  organization: WORKSPACE_MEMBER_LIMITS.organization,
  email: WORKSPACE_MEMBER_LIMITS.email,
  message: 2000,
  // Sessions chosen in one submission.
  committees: 20,
  // Requests waiting in one workspace's queue: beyond, new addresses are turned away for now.
  pendingPerWorkspace: 1000,
  // Decided requests listed at once (latest first).
  decidedListed: 200,
  formToken: 200,
  honeypot: 500,
} as const

// A form is sent at the earliest `minFillMs` after the page gave its token, at the latest
// `maxAgeMs` after.
export const PARTICIPATION_FORM_TIMING = {
  minFillMs: 3_000,
  maxAgeMs: 12 * 60 * 60 * 1000,
} as const

// Left empty by people (hidden from them, out of the tab order); filled by robots that fill every
// field. Any value: the submission is set aside, with the same answer as any other.
export const PARTICIPATION_HONEYPOT_FIELD = 'website'

// A committee offered on the public form.
export function committeeOpenToParticipationRequests(
  committee: { status: string; startsAt: string | Date; participationRequestsOpen: boolean },
  now: number,
): boolean {
  return (
    committee.participationRequestsOpen === true &&
    committeeStatusOf(committee.status) === 'planned' &&
    new Date(committee.startsAt).getTime() > now
  )
}

// What the public reads of a committee offered to requests: its name and when — a closed list
// picked from the shared view (`COMMITTEE_SHARED_FIELDS`), so nothing internal can ever reach it.
// The place, the link and the shared information stay for the committee's candidates and investors.
export const COMMITTEE_PUBLIC_FIELDS = [
  'id',
  'name',
  'date',
  'time',
  'timeZone',
  'startsAt',
] as const satisfies ReadonlyArray<CommitteeSharedField>
export type CommitteePublicField = (typeof COMMITTEE_PUBLIC_FIELDS)[number]

export const publicCommitteeSchema = sharedCommitteeSchema
  .pick(
    Object.fromEntries(COMMITTEE_PUBLIC_FIELDS.map((field) => [field, true])) as {
      [K in CommitteePublicField]: true
    },
  )
  .strict()
export type PublicCommittee = z.infer<typeof publicCommitteeSchema>

export function toPublicCommittee<T extends Record<CommitteeSharedField, unknown>>(
  committee: T,
): Pick<T, CommitteePublicField> {
  const shared = toSharedCommittee(committee)
  const view = {} as Pick<T, CommitteePublicField>
  for (const field of COMMITTEE_PUBLIC_FIELDS) view[field] = shared[field]
  return view
}

// The public page of a workspace's participation form.
export const participationFormSchema = z
  .object({
    workspace: z.object({ name: z.string(), programName: z.string().nullable() }).strict(),
    committees: z.array(publicCommitteeSchema),
    // Sent back with the form (anti-abuse, see above).
    formToken: z.string(),
  })
  .strict()
export type ParticipationForm = z.infer<typeof participationFormSchema>

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()
const blankToNull = (v: string) => (v === '' ? null : v)

const nameSchema = z
  .string({ message: 'Indiquez votre nom.' })
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Indiquez votre nom.')
      .max(
        PARTICIPATION_REQUEST_LIMITS.name,
        `Le nom compte au plus ${PARTICIPATION_REQUEST_LIMITS.name} caractères.`,
      ),
  )

const organizationSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .max(
        PARTICIPATION_REQUEST_LIMITS.organization,
        `L’organisation compte au plus ${PARTICIPATION_REQUEST_LIMITS.organization} caractères.`,
      ),
  )
  .transform(blankToNull)
  .nullable()

// Compared and kept in lower case (the address part only in ASCII: a non-ASCII address is refused).
const emailSchema = z
  .string({ message: 'Indiquez votre adresse email.' })
  .trim()
  .toLowerCase()
  .max(PARTICIPATION_REQUEST_LIMITS.email, 'L’adresse email est trop longue.')
  .email('L’adresse email n’est pas valide.')

const messageSchema = z
  .string()
  .transform(plainParagraphs)
  .pipe(
    z
      .string()
      .max(
        PARTICIPATION_REQUEST_LIMITS.message,
        `Le message compte au plus ${PARTICIPATION_REQUEST_LIMITS.message} caractères.`,
      )
      .refine((v) => !HTML_TAG.test(v), {
        message: 'Le message est un texte simple : les balises HTML ne sont pas acceptées.',
      }),
  )
  .transform(blankToNull)
  .nullable()

// One or more sessions, each once.
const committeeIdsSchema = z
  .array(z.string().uuid('Session inconnue.'), { message: 'Choisissez au moins une session.' })
  .min(1, 'Choisissez au moins une session.')
  .max(
    PARTICIPATION_REQUEST_LIMITS.committees,
    `Choisissez au plus ${PARTICIPATION_REQUEST_LIMITS.committees} sessions.`,
  )
  .transform((ids) => [...new Set(ids)])

export const createParticipationRequestSchema = z
  .object({
    name: nameSchema,
    organization: organizationSchema.optional(),
    email: emailSchema,
    message: messageSchema.optional(),
    committeeIds: committeeIdsSchema,
    formToken: z.string().max(PARTICIPATION_REQUEST_LIMITS.formToken),
    [PARTICIPATION_HONEYPOT_FIELD]: z
      .string()
      .max(PARTICIPATION_REQUEST_LIMITS.honeypot)
      .optional(),
  })
  .strict()
export type CreateParticipationRequestInput = z.input<typeof createParticipationRequestSchema>

// The answer to every accepted submission — recorded, merged or set aside alike.
export const PARTICIPATION_REQUEST_RECEIVED = 'Demande reçue.'

// A request as the workspace's managers read it, with the sessions it asks for (as they now are).
export const participationRequestSchema = z.object({
  id: z.string().uuid(),
  status: participationRequestStatusSchema,
  name: z.string(),
  organization: z.string().nullable(),
  email: z.string(),
  message: z.string().nullable(),
  committees: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      date: z.string(),
      time: z.string(),
      timeZone: z.string(),
      startsAt: z.string().datetime(),
      status: committeeStatusSchema,
    }),
  ),
  // How many times the form was sent for this request (the sessions of each added).
  submissionCount: z.number().int().min(1),
  lastSubmittedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  // E08.05: sent back with a decision.
  version: z.number().int().min(1),
  // Decided only: when, and by whom (null once that account is gone).
  decidedAt: z.string().datetime().nullable(),
  decidedBy: memberPersonSchema.nullable(),
  // Accepted only.
  admission: z.enum(PARTICIPATION_ADMISSIONS).nullable(),
  invitationEmail: z.enum(PARTICIPATION_INVITATION_EMAIL_STATUSES).nullable(),
  invitationEmailAt: z.string().datetime().nullable(),
})
export type ParticipationRequest = z.infer<typeof participationRequestSchema>

// The answer to a decision: the request as decided, and whether the acceptance email left (null when
// none was due: a refusal, or a decision already taken that this call only repeated).
export const participationDecisionResultSchema = z.object({
  request: participationRequestSchema,
  invitationEmailSent: z.boolean().nullable(),
})
export type ParticipationDecisionResult = z.infer<typeof participationDecisionResultSchema>
