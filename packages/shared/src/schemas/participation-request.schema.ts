import { z } from 'zod'
import {
  committeeStatusOf,
  committeeStatusSchema,
  sharedCommitteeSchema,
  toSharedCommittee,
} from './committee.schema.js'
import type { CommitteeSharedField } from './committee.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'
import { WORKSPACE_MEMBER_LIMITS } from './workspace-member.schema.js'

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
// account, no membership, no right, no email sent. E08.05 decides it (accepted / refused, by whom,
// when) and only then invites the person; until then the address given is not even known to be
// theirs. One pending request per address and workspace: a new submission while one is pending adds
// the sessions chosen to it and keeps what it said first.
//
// Anti-abuse (API side): a form token signed by the API, issued with the public page, refused when
// sent too soon after it (`PARTICIPATION_FORM_TIMING.minFillMs`) or too late; a field hidden from
// people (`PARTICIPATION_HONEYPOT_FIELD`) that only robots fill; rate limits per address and per
// network address; bounded fields. The answer is the same whether the address is known, already
// pending or silently set aside, so the form tells nobody who asked.
//
// The closed lists and limits are kept equal to the CHECK constraints of migration
// 20261204000000_participation_requests.

export const PARTICIPATION_REQUEST_STATUSES = ['pending'] as const
export const participationRequestStatusSchema = z.enum(PARTICIPATION_REQUEST_STATUSES)
export type ParticipationRequestStatus = z.infer<typeof participationRequestStatusSchema>

export const PARTICIPATION_REQUEST_STATUS_LABELS: Record<ParticipationRequestStatus, string> = {
  pending: 'À traiter',
}

export const PARTICIPATION_REQUEST_LIMITS = {
  name: 120,
  organization: WORKSPACE_MEMBER_LIMITS.organization,
  email: WORKSPACE_MEMBER_LIMITS.email,
  message: 2000,
  // Sessions chosen in one submission.
  committees: 20,
  // Requests waiting in one workspace's queue: beyond, new addresses are turned away for now.
  pendingPerWorkspace: 1000,
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
})
export type ParticipationRequest = z.infer<typeof participationRequestSchema>
