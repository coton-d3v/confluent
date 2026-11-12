import { z } from 'zod'
import { committeeStatusOf, sharedCommitteeSchema, toSharedCommittee } from './committee.schema.js'
import type { CommitteeSharedField } from './committee.schema.js'
import {
  CLOSED_FINANCING_STATUSES,
  FINANCING_STATUS_ACTORS,
  financingStatusOf,
  financingStatusSchema,
  type FinancingStatusActor,
} from './status.schema.js'

// ROADMAP E08.03: a financing request presented at a committee (glossary: « Comité », a pitch
// session) — through its candidature to the committee's workspace (E05.09), sent: the entrepreneur
// applies, or a conseiller of the workspace attaches the request; the other side answers. At most
// one entry per candidature and committee (unique in the database), kept and reused, never deleted
// but with its candidature or committee: its version only grows.
//
// A request is presented at a committee (`accepted`) only once BOTH sides agreed: the structure (it
// accepted the application, or proposed the request itself) and the entrepreneur (they applied, or
// confirmed the proposal) — nothing is decided for the entrepreneur, nothing is imposed on the
// structure.
//
// Who: the owner of the request (`owner`, the owner access to the candidature), or the workspace —
// its active conseillers and Confluent administrators, the people who follow its candidatures
// (`canReviewCandidatures`, `workspace`). Investors, other workspaces, other entrepreneurs and share
// recipients never read nor change an entry (E07: « en comité » is not shared with investors).
//
// When: only on a planned committee — a cancelled or held one keeps its entries as they were,
// read-only, until a manager puts it back to planned. The entrepreneur applies or confirms only
// before the committee starts; whatever brings a request to a committee (applied, proposed,
// accepted) needs its financing status open in that workspace (not funded, refused or abandoned)
// and the request not archived. Withdrawing or refusing is always possible on a planned committee.
//
// What the entrepreneur reads of a committee: the shared view of E08.02 (`toSharedCommittee`, never
// the internal notes) through `candidateCommitteeOf`, which keeps the meeting link for the
// entrepreneurs the committee accepted. Which committees: those of the workspaces they sent a
// candidature to, planned and not started yet, and any committee their candidature has an entry on.
//
// The closed lists are kept equal to the CHECK constraints of migration
// 20261203000000_committee_applications.

export const COMMITTEE_APPLICATION_STATUSES = [
  'applied',
  'proposed',
  'accepted',
  'refused',
  'withdrawn',
] as const
export const committeeApplicationStatusSchema = z.enum(COMMITTEE_APPLICATION_STATUSES, {
  message: 'Choisissez un statut de participation au comité.',
})
export type CommitteeApplicationStatus = z.infer<typeof committeeApplicationStatusSchema>

// The side that made the last change of an entry: the entrepreneur, or the structure (never which
// of its members, for the entrepreneur).
export const COMMITTEE_APPLICATION_SIDES = FINANCING_STATUS_ACTORS
export type CommitteeApplicationSide = FinancingStatusActor
export const committeeApplicationSideSchema = z.enum(COMMITTEE_APPLICATION_SIDES)

export const COMMITTEE_APPLICATION_STATUS_LABELS: Record<CommitteeApplicationStatus, string> = {
  applied: 'Candidature en attente',
  proposed: 'Proposition en attente',
  accepted: 'Retenue',
  refused: 'Refusée',
  withdrawn: 'Retirée',
}

// Closed by default: a status this version does not know is read as `refused`, from which only the
// structure proposes the request again.
export function committeeApplicationStatusOf(raw: string | null | undefined) {
  return (COMMITTEE_APPLICATION_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as CommitteeApplicationStatus)
    : 'refused'
}

export function committeeApplicationSideOf(
  raw: string | null | undefined,
): CommitteeApplicationSide {
  return raw === 'owner' ? 'owner' : 'workspace'
}

// The statuses that bring a request to a committee: they need an open committee, an open financing
// status and a request not archived.
export const ENGAGING_COMMITTEE_APPLICATION_STATUSES: ReadonlyArray<CommitteeApplicationStatus> = [
  'applied',
  'proposed',
  'accepted',
]

// Every allowed transition (`from: null`: no entry yet), and who may make it; anything else is
// refused. The entrepreneur applies (again after a withdrawal, never after a refusal), confirms a
// proposal, withdraws; the structure proposes (again after a withdrawal or a refusal), accepts or
// refuses an application, withdraws its proposal or a request it retained.
export const COMMITTEE_APPLICATION_TRANSITIONS: ReadonlyArray<{
  from: CommitteeApplicationStatus | null
  to: CommitteeApplicationStatus
  by: ReadonlyArray<CommitteeApplicationSide>
}> = [
  { from: null, to: 'applied', by: ['owner'] },
  { from: 'withdrawn', to: 'applied', by: ['owner'] },
  { from: null, to: 'proposed', by: ['workspace'] },
  { from: 'withdrawn', to: 'proposed', by: ['workspace'] },
  { from: 'refused', to: 'proposed', by: ['workspace'] },
  { from: 'applied', to: 'accepted', by: ['workspace'] },
  { from: 'proposed', to: 'accepted', by: ['owner'] },
  { from: 'applied', to: 'refused', by: ['workspace'] },
  { from: 'applied', to: 'withdrawn', by: ['owner'] },
  { from: 'proposed', to: 'withdrawn', by: ['owner', 'workspace'] },
  { from: 'accepted', to: 'withdrawn', by: ['owner', 'workspace'] },
]

// `allowed`; `forbidden`: allowed to the other side only; `impossible`: allowed to nobody.
export function committeeApplicationTransition(
  from: CommitteeApplicationStatus | null,
  to: CommitteeApplicationStatus,
  by: CommitteeApplicationSide,
): 'allowed' | 'forbidden' | 'impossible' {
  const transition = COMMITTEE_APPLICATION_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return 'impossible'
  return transition.by.includes(by) ? 'allowed' : 'forbidden'
}

// The statuses a side may move an entry to from its current one, in the order of the list.
export function committeeApplicationTransitionsFor(
  from: CommitteeApplicationStatus | null,
  by: CommitteeApplicationSide,
): CommitteeApplicationStatus[] {
  return COMMITTEE_APPLICATION_STATUSES.filter(
    (to) => committeeApplicationTransition(from, to, by) === 'allowed',
  )
}

// A committee the entrepreneur may apply to (or confirm a proposal for): planned and not started.
export function committeeOpenToCandidates(
  committee: { status: string; startsAt: string | Date },
  now: number,
): boolean {
  return (
    committeeStatusOf(committee.status) === 'planned' &&
    new Date(committee.startsAt).getTime() > now
  )
}

// Whether a candidature's financing status in the workspace still lets it be brought to a committee.
export function financingOpenToCommittees(financingStatus: string): boolean {
  return !CLOSED_FINANCING_STATUSES.includes(financingStatusOf(financingStatus))
}

// What the entrepreneur reads of a committee: the shared view (E08.02), its meeting link only once
// the committee accepted their request (the most restrictive reading: a link to join is for those
// who will pitch).
export function candidateCommitteeOf<T extends Record<CommitteeSharedField, unknown>>(
  committee: T,
  application: { status: string } | null,
): Pick<T, CommitteeSharedField> {
  const shared = toSharedCommittee(committee)
  return application?.status === 'accepted'
    ? shared
    : ({ ...shared, meetingUrl: null } as Pick<T, CommitteeSharedField>)
}

// A change of an entry, from the version the client read: `null` when it saw none (a first
// application or attachment). A change made meanwhile is refused (409), never overwritten — two
// applications at once create one entry.
export const changeCommitteeApplicationSchema = z
  .object({
    to: committeeApplicationStatusSchema,
    version: z.number().int().min(1).nullable(),
  })
  .strict()
export type ChangeCommitteeApplicationInput = z.infer<typeof changeCommitteeApplicationSchema>

// The structure's side names the candidature (one it received, of this workspace).
export const changeWorkspaceCommitteeApplicationSchema = changeCommitteeApplicationSchema
  .extend({ candidatureId: z.string().uuid('Choisissez une candidature reçue.') })
  .strict()
export type ChangeWorkspaceCommitteeApplicationInput = z.infer<
  typeof changeWorkspaceCommitteeApplicationSchema
>

// The entrepreneur's entry on a committee: its status, which side made the last change (never who
// among the structure), when, and its version.
export const ownerCommitteeApplicationSchema = z
  .object({
    id: z.string().uuid(),
    status: committeeApplicationStatusSchema,
    by: committeeApplicationSideSchema,
    changedAt: z.string().datetime(),
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
  })
  .strict()
export type OwnerCommitteeApplication = z.infer<typeof ownerCommitteeApplicationSchema>

// A committee as the entrepreneur reads it from their candidature, with their entry on it if any.
export const candidateCommitteeSchema = z
  .object({
    committee: sharedCommitteeSchema,
    application: ownerCommitteeApplicationSchema.nullable(),
  })
  .strict()
export type CandidateCommittee = z.infer<typeof candidateCommitteeSchema>

// An entry as the workspace's conseillers read it on the committee: the candidature's company,
// request and financing status, and who made the last change.
export const committeeApplicationSchema = z.object({
  id: z.string().uuid(),
  committeeId: z.string().uuid(),
  status: committeeApplicationStatusSchema,
  by: committeeApplicationSideSchema,
  changedBy: z
    .object({
      email: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .nullable(),
  changedAt: z.string().datetime(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  candidature: z.object({
    id: z.string().uuid(),
    financingStatus: financingStatusSchema,
    company: z.object({ name: z.string() }),
    dossier: z.object({ name: z.string() }),
  }),
})
export type CommitteeApplication = z.infer<typeof committeeApplicationSchema>
