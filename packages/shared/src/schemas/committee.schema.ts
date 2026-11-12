import { z } from 'zod'
import { isCalendarDate } from '../rules/calendar.js'
import { canonicalTimeZone, resolveZonedTime } from '../rules/zoned-time.js'
import { canReviewCandidatures } from './candidature.schema.js'
import { HTML_TAG, plainParagraphs } from './support-path.schema.js'

// ROADMAP E08.01: the committees (glossary: « Comité », a pitch session) a workspace organises — a
// name, when (a wall-clock date and time in a named IANA time zone), where (a place and/or a link
// to join online), a status and useful information.
//
// When: the committee is « at 14:00 in Paris », whatever the zone of whoever reads it. Stored as
// typed (`date`, `time`, `timeZone`), with the instant it designates (`startsAt`) derived by the API
// at each write of the schedule (`resolveZonedTime`): a time skipped or repeated by a change of
// offset is refused. Shown in the committee's zone, named.
//
// Status: `planned` (programmé) → `held` (tenu, once its start has passed) or `cancelled` (annulé);
// both can be undone back to `planned` (a mistake corrected, a committee restored). Cancelling is a
// status, never a deletion: a committee is never deleted. Only a planned committee is edited.
//
// Two texts, kept apart (ROADMAP E08.02): `internalNotes`, for the workspace only — read by those
// who read its committees, never by a candidate, an investor or anyone outside it, never in the
// shared view, a journal entry or an email —; `sharedInfo`, written by the same managers for the
// committee's candidates and investors. What they will read of a committee is `toSharedCommittee`
// (`COMMITTEE_SHARED_FIELDS`, closed list), the only view any reader outside the workspace's
// conseillers may get; nobody reads it yet: E08.03 (candidates) and E08.04–E08.06 (participants)
// decide who does.
//
// Who: read by those who follow the workspace's candidatures (its active conseillers and Confluent
// administrators, `canReadCommittees`); created, edited and cancelled by those who manage the
// workspace (`canManageWorkspace`, API side). Closed by default: an investisseur of the workspace,
// an unknown role or no membership read nothing.
//
// The closed lists and limits are kept equal to the CHECK constraints of migration
// 20261201000000_committees.

export function canReadCommittees(
  actor: { role: string },
  membership: { role: string } | null,
): boolean {
  return canReviewCandidatures(actor, membership)
}

export const COMMITTEE_STATUSES = ['planned', 'held', 'cancelled'] as const
export const committeeStatusSchema = z.enum(COMMITTEE_STATUSES, {
  message: 'Choisissez un statut de comité.',
})
export type CommitteeStatus = z.infer<typeof committeeStatusSchema>

export const COMMITTEE_STATUS_LABELS: Record<CommitteeStatus, string> = {
  planned: 'Programmé',
  held: 'Tenu',
  cancelled: 'Annulé',
}

// From each status, the statuses a manager can move a committee to.
export const COMMITTEE_STATUS_TRANSITIONS: Record<CommitteeStatus, readonly CommitteeStatus[]> = {
  planned: ['held', 'cancelled'],
  held: ['planned'],
  cancelled: ['planned'],
}

export function canChangeCommitteeStatus(from: string, to: CommitteeStatus): boolean {
  const allowed = (COMMITTEE_STATUS_TRANSITIONS as Record<string, readonly CommitteeStatus[]>)[from]
  return allowed?.includes(to) ?? false
}

// Closed by default: a status this version does not know is read as `cancelled`, which nothing
// edits.
export function committeeStatusOf(raw: string): CommitteeStatus {
  return (COMMITTEE_STATUSES as readonly string[]).includes(raw)
    ? (raw as CommitteeStatus)
    : 'cancelled'
}

export const COMMITTEE_LIMITS = {
  name: 120,
  location: 300,
  meetingUrl: 500,
  internalNotes: 5000,
  sharedInfo: 3000,
  perWorkspace: 500,
  firstYear: 2000,
  lastYear: 2099,
} as const

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()
const blankToNull = (v: string) => (v === '' ? null : v)

const nameSchema = z
  .string({ message: 'Le nom du comité est obligatoire.' })
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Le nom du comité est obligatoire.')
      .max(COMMITTEE_LIMITS.name, `Le nom compte au plus ${COMMITTEE_LIMITS.name} caractères.`),
  )

const dateSchema = z
  .string({ message: 'La date du comité est obligatoire.' })
  .trim()
  .refine(isCalendarDate, { message: 'Indiquez une date valide (AAAA-MM-JJ).' })
  .refine(
    (v) => {
      const year = Number(v.slice(0, 4))
      return year >= COMMITTEE_LIMITS.firstYear && year <= COMMITTEE_LIMITS.lastYear
    },
    {
      message: `L’année du comité est comprise entre ${COMMITTEE_LIMITS.firstYear} et ${COMMITTEE_LIMITS.lastYear}.`,
    },
  )

export const COMMITTEE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const timeSchema = z
  .string({ message: 'L’heure du comité est obligatoire.' })
  .trim()
  .regex(COMMITTEE_TIME_PATTERN, 'Indiquez une heure valide (HH:MM, de 00:00 à 23:59).')

const timeZoneSchema = z
  .string({ message: 'Le fuseau horaire est obligatoire.' })
  .trim()
  .transform((v, ctx) => {
    const zone = canonicalTimeZone(v)
    if (zone === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choisissez un fuseau horaire de la liste (par exemple Europe/Paris).',
      })
      return z.NEVER
    }
    return zone
  })

// One line: an address, a room.
const locationSchema = z
  .string()
  .transform(oneLine)
  .pipe(
    z
      .string()
      .max(
        COMMITTEE_LIMITS.location,
        `Le lieu compte au plus ${COMMITTEE_LIMITS.location} caractères.`,
      ),
  )
  .transform(blankToNull)
  .nullable()

// A link to join online, opened in a new tab: `https` only, without credentials, a real host name.
// Stored as the browser reads it (`URL.href`), the one shown and followed.
export function normalizeMeetingUrl(raw: string): string | null {
  const value = raw.trim()
  if (value === '' || /[\s\u0000-\u001f\u007f]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  if (!/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/i.test(url.hostname)) return null
  return url.href
}

const meetingUrlSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    const url = normalizeMeetingUrl(v)
    if (url === null) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Le lien de visioconférence est une adresse https:// complète (sans identifiants).',
      })
      return z.NEVER
    }
    if (url.length > COMMITTEE_LIMITS.meetingUrl) {
      ctx.addIssue({
        code: 'custom',
        message: `Le lien compte au plus ${COMMITTEE_LIMITS.meetingUrl} caractères.`,
      })
      return z.NEVER
    }
    return url
  })
  .nullable()

// Plain text in paragraphs, bounded; blank is none.
const plainTextSchema = (max: number, what: string) =>
  z
    .string()
    .transform(plainParagraphs)
    .pipe(
      z
        .string()
        .max(max, `${what} comptent au plus ${max} caractères.`)
        .refine((v) => !HTML_TAG.test(v), {
          message: `${what} sont un texte simple : les balises HTML ne sont pas acceptées.`,
        }),
    )
    .transform(blankToNull)
    .nullable()

const internalNotesSchema = plainTextSchema(COMMITTEE_LIMITS.internalNotes, 'Les notes internes')
const sharedInfoSchema = plainTextSchema(COMMITTEE_LIMITS.sharedInfo, 'Les informations diffusées')

// The wall-clock time must designate exactly one instant in its zone.
export function zonedTimeIssue(date: string, time: string, timeZone: string): string | null {
  const resolved = resolveZonedTime(date, time, timeZone)
  if (resolved.kind === 'skipped') {
    return `Cette heure n’existe pas le ${date} à ${timeZone} (passage à l’heure d’été) : choisissez une autre heure.`
  }
  if (resolved.kind === 'repeated') {
    return `Cette heure existe deux fois le ${date} à ${timeZone} (retour à l’heure d’hiver) : choisissez une autre heure.`
  }
  return null
}

// What a manager types, whole: creating a committee and editing one send the same fields. A place
// and a link are optional (« lieu à préciser »), and so are both texts. On an edit, an absent
// `sharedInfo` keeps the current one (a client that predates it never erases it); `null` or blank
// removes it.
const committeeFields = z
  .object({
    name: nameSchema,
    date: dateSchema,
    time: timeSchema,
    timeZone: timeZoneSchema,
    location: locationSchema.optional(),
    meetingUrl: meetingUrlSchema.optional(),
    internalNotes: internalNotesSchema.optional(),
    sharedInfo: sharedInfoSchema.optional(),
  })
  .strict()

const schedulable = <T extends { date: string; time: string; timeZone: string }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  // Only once each part is valid (their own issues are already reported).
  const parts =
    typeof value.date === 'string' &&
    isCalendarDate(value.date) &&
    typeof value.time === 'string' &&
    COMMITTEE_TIME_PATTERN.test(value.time) &&
    typeof value.timeZone === 'string' &&
    canonicalTimeZone(value.timeZone) !== null
  if (!parts) return
  const issue = zonedTimeIssue(value.date, value.time, value.timeZone)
  if (issue) ctx.addIssue({ code: 'custom', path: ['time'], message: issue })
}

export const createCommitteeSchema = committeeFields.superRefine(schedulable)

// Every field again, from the version the manager read: a committee changed meanwhile is refused
// (409), never overwritten.
export const updateCommitteeSchema = committeeFields
  .extend({ version: z.number().int().min(1) })
  .strict()
  .superRefine(schedulable)

export const changeCommitteeStatusSchema = z
  .object({ status: committeeStatusSchema, version: z.number().int().min(1) })
  .strict()

export type CreateCommitteeInput = z.input<typeof createCommitteeSchema>
export type UpdateCommitteeInput = z.input<typeof updateCommitteeSchema>
export type ChangeCommitteeStatusInput = z.input<typeof changeCommitteeStatusSchema>

export const committeeSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  // As typed, in `timeZone`.
  date: z.string(),
  time: z.string(),
  timeZone: z.string(),
  // The instant they designate.
  startsAt: z.string().datetime(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  status: committeeStatusSchema,
  // For the workspace's conseillers only.
  internalNotes: z.string().nullable(),
  // For the committee's candidates and investors.
  sharedInfo: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Committee = z.infer<typeof committeeSchema>

// What a committee's candidates and investors will read of it — the only view of a committee for any
// reader outside the workspace's conseillers (ROADMAP E08.02): its name, when (the time typed, its
// zone and the instant), where (place and link: they are told how to join), its status (a cancelled
// committee is known as such) and the information shared with them. Closed list: neither the
// internal notes, nor the version, nor the dates of its records, nor its workspace's identifier; a
// field added to a committee stays out of it until it is named here.
export const COMMITTEE_SHARED_FIELDS = [
  'id',
  'name',
  'date',
  'time',
  'timeZone',
  'startsAt',
  'location',
  'meetingUrl',
  'status',
  'sharedInfo',
] as const satisfies ReadonlyArray<keyof Committee>
export type CommitteeSharedField = (typeof COMMITTEE_SHARED_FIELDS)[number]

export const sharedCommitteeSchema = committeeSchema
  .pick(
    Object.fromEntries(COMMITTEE_SHARED_FIELDS.map((field) => [field, true])) as {
      [K in CommitteeSharedField]: true
    },
  )
  .strict()
export type SharedCommittee = z.infer<typeof sharedCommitteeSchema>

// Copies the shared fields only, by name (whatever else the source holds), the same way for the API's
// view (`startsAt` a Date) and the site's (`startsAt` a string).
export function toSharedCommittee<T extends Record<CommitteeSharedField, unknown>>(
  committee: T,
): Pick<T, CommitteeSharedField> {
  const shared = {} as Pick<T, CommitteeSharedField>
  for (const field of COMMITTEE_SHARED_FIELDS) shared[field] = committee[field]
  return shared
}
