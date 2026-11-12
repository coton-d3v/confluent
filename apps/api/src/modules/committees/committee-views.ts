import type { Committee } from '@prisma/client'
import { committeeStatusOf, toSharedCommittee, type CommitteeStatus } from '@confluent/shared'

// How a committee is read (ROADMAP E08.01, E08.02): whole by the workspace's conseillers
// (`CommitteeView`); by anyone else only through its shared view, which never holds the internal
// notes — `sharedCommitteeOf`, or for its candidates (E08.03) `candidateCommitteeOf` of
// @confluent/shared, the same view with the link once their request is accepted; by the public
// (E08.04), when a manager offers it on the participation form, `toPublicCommittee` — name and when.

export interface CommitteeView {
  id: string
  workspaceId: string
  name: string
  date: string
  time: string
  timeZone: string
  startsAt: Date
  location: string | null
  meetingUrl: string | null
  status: CommitteeStatus
  internalNotes: string | null
  sharedInfo: string | null
  // E08.04: offered on the workspace's public participation form.
  participationRequestsOpen: boolean
  version: number
  createdAt: Date
  updatedAt: Date
}

export type SharedCommitteeView = ReturnType<typeof sharedCommitteeOf>

// Every column of `committees`, and who may read it: `shared` reaches the committee's candidates and
// investors (through `sharedCommitteeOf`), `internal` stays with the workspace's conseillers. A
// column added to the table without being classified here fails to compile, and the tests check this
// list against the Prisma model and the database (closed by default: a new column is internal until
// it is named shared, and the shared view copies named fields only).
export const COMMITTEE_COLUMN_AUDIENCE = {
  id: 'shared',
  workspaceId: 'internal',
  name: 'shared',
  // Read as `date` and `time`, with `timeZone` and `startsAt`.
  localStart: 'shared',
  timeZone: 'shared',
  startsAt: 'shared',
  location: 'shared',
  meetingUrl: 'shared',
  status: 'shared',
  internalNotes: 'internal',
  sharedInfo: 'shared',
  // E08.04: the managers' choice; the public reads only which committees are offered, through
  // `toPublicCommittee` (@confluent/shared).
  participationRequestsOpen: 'internal',
  version: 'internal',
  createdAt: 'internal',
  updatedAt: 'internal',
} as const satisfies Record<keyof Committee, 'shared' | 'internal'>

export function toView(row: Committee): CommitteeView {
  const { date, time } = scheduleOf(row)
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    date,
    time,
    timeZone: row.timeZone,
    startsAt: row.startsAt,
    location: row.location,
    meetingUrl: row.meetingUrl,
    status: committeeStatusOf(row.status),
    internalNotes: row.internalNotes,
    sharedInfo: row.sharedInfo,
    participationRequestsOpen: row.participationRequestsOpen,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// What a committee's candidates and investors read of it: the shared fields of @confluent/shared,
// copied by name from the conseillers' view.
export function sharedCommitteeOf(row: Committee) {
  return toSharedCommittee(toView(row))
}

export function scheduleOf(row: Pick<Committee, 'localStart' | 'timeZone' | 'startsAt'>) {
  const iso = row.localStart.toISOString()
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    timeZone: row.timeZone,
    startsAt: row.startsAt.toISOString(),
  }
}
