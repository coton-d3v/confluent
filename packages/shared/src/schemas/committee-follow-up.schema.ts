import { z } from 'zod'
import {
  COMMITTEE_APPLICATION_STATUSES,
  ENGAGING_COMMITTEE_APPLICATION_STATUSES,
} from './committee-application.schema.js'
import { toSharedCommittee, type CommitteeStatus } from './committee.schema.js'
import type { CommitteeSharedField } from './committee.schema.js'

// ROADMAP E08.06: following a committee — which lists each audience reads, its progress, and the
// notices a change of date or a cancellation sends.
//
// Who reads what (closed by default, D05 unconfirmed: the most restrictive reading):
//  * the workspace's conseillers and Confluent's administrators (`canReadCommittees`): the requests
//    on its agenda (E08.03, `committeeApplicationSchema`) and its progress (`committeeProgressSchema`,
//    counts only — no name of a participant);
//  * its managers (`canManageWorkspace`) — who decide the participation requests (E08.05) —, also
//    the participants by name (`committeeParticipantSchema`) and the notices sent
//    (`committeeNoticeSchema`);
//  * an entrepreneur: their own entry only (E08.03), never the other requests nor the participants;
//  * a participant — the account a manager accepted for this session (E08.05), still an active
//    member of the workspace —: the committee's shared view (`participantCommitteeOf`, link
//    included, never the internal notes), and nothing of its agenda nor of the other participants
//    (being « en comité » is not shared with investors, E07.02/E07.03: no owner consented to it);
//  * anyone else: nothing.
//
// Progress (« avancement »): per committee, how many entries of each status (E08.03) and how many
// participants — accepted and still members (`accepted`), or still waiting for a decision
// (`pending`); its date and status are the committee's own.
//
// Notices: a planned committee whose schedule changes (`rescheduled`), a committee cancelled
// (`cancelled`), or a cancelled one restored (`restored`) tells, by email, the owners of the
// requests it brings (entries applied, proposed or accepted — they read it from their candidature)
// and its participants. One notice per change and person (the committee's version the change
// produced: a change is never notified twice, a retry of the same request changes nothing), recorded
// in the change's transaction (`to_send`), sent after it (`sending`, then `sent` or `failed`), never
// blocking the change; a later change supersedes the notices of an earlier one still unsent to the
// same person (`superseded`): each person is told the committee as it last became. An email holds
// the committee's name, when it takes place (and took place before, for a new date) and its
// workspace — never the place, the link, the shared information nor the internal notes: the person
// signs in to read them, as their rights allow.
//
// The closed lists are kept equal to the CHECK constraints of migration
// 20261206000000_committee_notices.

export const COMMITTEE_NOTICE_KINDS = ['rescheduled', 'cancelled', 'restored'] as const
export type CommitteeNoticeKind = (typeof COMMITTEE_NOTICE_KINDS)[number]
export const committeeNoticeKindSchema = z.enum(COMMITTEE_NOTICE_KINDS)

export const COMMITTEE_NOTICE_KIND_LABELS: Record<CommitteeNoticeKind, string> = {
  rescheduled: 'Changement de date',
  cancelled: 'Annulation',
  restored: 'Rétablissement',
}

// What a manager's change tells: a new schedule (date, time or zone) of a planned committee, its
// cancellation, or its return to planned from cancelled. Nothing else is notified (a new name, place
// or text is read in the site; a committee marked held, or put back from held, tells nobody).
export function committeeNoticeKind(
  change: { fields: readonly string[] } | { from: CommitteeStatus; to: CommitteeStatus },
): CommitteeNoticeKind | null {
  if ('fields' in change) return change.fields.includes('schedule') ? 'rescheduled' : null
  if (change.from === 'planned' && change.to === 'cancelled') return 'cancelled'
  if (change.from === 'cancelled' && change.to === 'planned') return 'restored'
  return null
}

export const COMMITTEE_NOTICE_STATES = [
  'to_send',
  'sending',
  'sent',
  'failed',
  'superseded',
] as const
export type CommitteeNoticeState = (typeof COMMITTEE_NOTICE_STATES)[number]
export const committeeNoticeStateSchema = z.enum(COMMITTEE_NOTICE_STATES)

export const COMMITTEE_NOTICE_STATE_LABELS: Record<CommitteeNoticeState, string> = {
  to_send: 'Envoi non confirmé',
  sending: 'Envoi non confirmé',
  sent: 'Envoyé',
  failed: 'Échec de l’envoi',
  superseded: 'Remplacé par une notification plus récente',
}

// Closed by default: a state this version does not know is not read as sent.
export function committeeNoticeStateOf(raw: string): CommitteeNoticeState {
  return (COMMITTEE_NOTICE_STATES as readonly string[]).includes(raw)
    ? (raw as CommitteeNoticeState)
    : 'failed'
}

export const COMMITTEE_NOTICE_AUDIENCES = ['entrepreneur', 'participant'] as const
export type CommitteeNoticeAudience = (typeof COMMITTEE_NOTICE_AUDIENCES)[number]

// The entries whose request's owner is told: those that bring the request to the committee.
export const NOTIFIED_COMMITTEE_APPLICATION_STATUSES = ENGAGING_COMMITTEE_APPLICATION_STATUSES

export const COMMITTEE_FOLLOW_UP_LIMITS = {
  // Notices listed at once, the latest change first.
  noticesListed: 500,
} as const

// What a participant reads of a committee they were accepted for: the whole shared view (E08.02),
// the meeting link included — as for an entrepreneur once retained (E08.03), the link goes to those
// who will attend.
export function participantCommitteeOf<T extends Record<CommitteeSharedField, unknown>>(
  committee: T,
): Pick<T, CommitteeSharedField> {
  return toSharedCommittee(committee)
}

const count = z.number().int().min(0)

export const committeeProgressSchema = z
  .object({
    committeeId: z.string().uuid(),
    applications: z
      .object(
        Object.fromEntries(COMMITTEE_APPLICATION_STATUSES.map((s) => [s, count])) as Record<
          (typeof COMMITTEE_APPLICATION_STATUSES)[number],
          typeof count
        >,
      )
      .strict(),
    participants: z.object({ accepted: count, pending: count }).strict(),
  })
  .strict()
export type CommitteeProgress = z.infer<typeof committeeProgressSchema>

// Whether a participant's account is still an active member of the workspace: one that is not
// reads nothing of the committee and is told nothing.
export const COMMITTEE_PARTICIPANT_ACCESS = ['active', 'inactive'] as const
export type CommitteeParticipantAccess = (typeof COMMITTEE_PARTICIPANT_ACCESS)[number]

export const committeeParticipantSchema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string(),
    organization: z.string().nullable(),
    email: z.string(),
    decidedAt: z.string().datetime().nullable(),
    access: z.enum(COMMITTEE_PARTICIPANT_ACCESS),
  })
  .strict()
export type CommitteeParticipant = z.infer<typeof committeeParticipantSchema>

// One person told of one change, as the managers read it: who (the request on the agenda, or the
// participant's request — never an email address), and what became of the email.
export const committeeNoticeSchema = z
  .object({
    id: z.string().uuid(),
    committeeVersion: z.number().int().min(1),
    kind: committeeNoticeKindSchema,
    audience: z.enum(COMMITTEE_NOTICE_AUDIENCES),
    label: z.string(),
    state: committeeNoticeStateSchema,
    stateAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict()
export type CommitteeNotice = z.infer<typeof committeeNoticeSchema>
