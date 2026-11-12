import { Injectable } from '@nestjs/common'
import type { Committee, Prisma } from '@prisma/client'
import {
  COMMITTEE_LIMITS,
  canChangeCommitteeStatus,
  canReadCommittees,
  committeeStatusOf,
  resolveZonedTime,
  zonedTimeIssue,
  type CommitteeStatus,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { CommitteeErrors } from './committee-errors'
import { scheduleOf, toView, type CommitteeView } from './committee-views'

export type { CommitteeView } from './committee-views'

// What a manager sends, as validated by createCommitteeSchema / updateCommitteeSchema (an absent
// place, link or internal notes is none; absent shared information is none on creation and kept as
// it is on an edit).
export interface CommitteeInput {
  name: string
  date: string
  time: string
  timeZone: string
  location?: string | null
  meetingUrl?: string | null
  internalNotes?: string | null
  sharedInfo?: string | null
  // E08.04: absent, closed for a new committee and kept as it is on an edit.
  participationRequestsOpen?: boolean
}

type Field =
  | 'name'
  | 'schedule'
  | 'location'
  | 'meetingUrl'
  | 'internalNotes'
  | 'sharedInfo'
  | 'participationRequestsOpen'

const ORDER = [{ startsAt: 'asc' as const }, { createdAt: 'asc' as const }]

// The committees a workspace organises (ROADMAP E08.01, rules in @confluent/shared
// `committee.schema.ts`). Read by those who follow its candidatures — its active conseillers and
// Confluent administrators (`canReadCommittees`), `403` for its investisseurs —; created, edited and
// cancelled by those who manage it (`canManageWorkspace`, `403` for its other members); `404` alike
// outside the workspace and for a committee of another one. Each rule is read at every request, and
// every write locks the workspace row first and reads the right again after the lock (code review
// R53): a manager deprived of the right or deactivated while the request waited writes nothing. A
// write starts from the version the client read (`409` otherwise) and is journaled in the same
// transaction. MCP: no tool yet (E08.07).
//
// Two texts (E08.02): `internalNotes` for the conseillers only, `sharedInfo` for the committee's
// candidates and investors, edited alike; a journal entry names a changed text, never copies it.
// Outside the conseillers, a committee is read through its shared view only, never `CommitteeView`:
// by the entrepreneurs who may apply to it or whose request has an entry on it (E08.03,
// `CommitteeApplicationsService`, the link once accepted); by the public, its name and when only,
// once a manager offers it on the workspace's participation form (E08.04,
// `participationRequestsOpen`, `ParticipationRequestsService`); its participants come with
// E08.05–E08.06.
//
// Extension point: E08.06 notifies a change of schedule or a cancellation — `update` and
// `changeStatus` already tell which fields changed.
@Injectable()
export class CommitteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  // Every committee of the workspace — cancelled and held ones included —, earliest first.
  async list(actor: WorkspaceActor, workspaceId: string): Promise<CommitteeView[]> {
    await this.assertCanRead(actor, workspaceId)
    const rows = await this.prisma.committee.findMany({ where: { workspaceId }, orderBy: ORDER })
    return rows.map(toView)
  }

  async get(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
  ): Promise<CommitteeView> {
    await this.assertCanRead(actor, workspaceId)
    const row = await this.prisma.committee.findFirst({ where: { id: committeeId, workspaceId } })
    if (!row) throw CommitteeErrors.notFound()
    return toView(row)
  }

  // A new committee is planned.
  async create(
    actor: WorkspaceActor,
    workspaceId: string,
    input: CommitteeInput,
  ): Promise<CommitteeView> {
    await this.access.assertCanManage(actor, workspaceId)
    const data = {
      ...scheduled(input),
      sharedInfo: input.sharedInfo ?? null,
      participationRequestsOpen: input.participationRequestsOpen ?? false,
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockForManager(tx, actor, workspaceId)
      const count = await tx.committee.count({ where: { workspaceId } })
      if (count >= COMMITTEE_LIMITS.perWorkspace) throw CommitteeErrors.tooMany()
      const committee = await tx.committee.create({
        data: { workspaceId, ...data, status: 'planned', version: 1 },
      })
      await this.audit.recordIn(tx, {
        actionType: 'committee_created',
        actorId: actor.id,
        metadata: {
          workspaceId,
          committeeId: committee.id,
          version: committee.version,
          name: committee.name,
          schedule: scheduleOf(committee),
        },
      })
      return committee
    })
    return toView(created)
  }

  // Every field again, from the version the client read; only a planned committee is edited. The
  // same values write nothing (no new version, no journal entry).
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
    input: CommitteeInput & { version: number },
  ): Promise<CommitteeView> {
    await this.access.assertCanManage(actor, workspaceId)
    const data = scheduled(input)
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockCommittee(tx, actor, workspaceId, committeeId, input.version)
      const status = committeeStatusOf(current.status)
      if (status !== 'planned') throw CommitteeErrors.notEditable(status)
      const next = {
        ...data,
        sharedInfo: input.sharedInfo === undefined ? current.sharedInfo : input.sharedInfo,
        participationRequestsOpen:
          input.participationRequestsOpen ?? current.participationRequestsOpen,
      }
      const changed = changedFields(current, next)
      if (changed.length === 0) return current
      const committee = await tx.committee.update({
        where: { id: current.id },
        data: { ...next, version: current.version + 1 },
      })
      await this.audit.recordIn(tx, {
        actionType: 'committee_updated',
        actorId: actor.id,
        metadata: {
          workspaceId,
          committeeId,
          version: committee.version,
          // The place, link and both texts are named, never copied: the journal outlives them, and
          // the internal notes never leave the committee.
          fields: changed,
          ...(changed.includes('name') ? { name: { from: current.name, to: committee.name } } : {}),
          ...(changed.includes('schedule')
            ? { schedule: { from: scheduleOf(current), to: scheduleOf(committee) } }
            : {}),
          ...(changed.includes('participationRequestsOpen')
            ? {
                participationRequestsOpen: {
                  from: current.participationRequestsOpen,
                  to: committee.participationRequestsOpen,
                },
              }
            : {}),
        },
      })
      return committee
    })
    return toView(updated)
  }

  // Cancel, mark held (once its start has passed), or put back to planned — from the version the
  // client read.
  async changeStatus(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
    input: { status: CommitteeStatus; version: number },
  ): Promise<CommitteeView> {
    await this.access.assertCanManage(actor, workspaceId)
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockCommittee(tx, actor, workspaceId, committeeId, input.version)
      const from = committeeStatusOf(current.status)
      if (!canChangeCommitteeStatus(current.status, input.status)) {
        throw CommitteeErrors.transition(from, input.status)
      }
      if (input.status === 'held' && current.startsAt.getTime() > Date.now()) {
        throw CommitteeErrors.notStarted()
      }
      const committee = await tx.committee.update({
        where: { id: current.id },
        data: { status: input.status, version: current.version + 1 },
      })
      await this.audit.recordIn(tx, {
        actionType: 'committee_status_changed',
        actorId: actor.id,
        metadata: {
          workspaceId,
          committeeId,
          version: committee.version,
          from,
          to: input.status,
        },
      })
      return committee
    })
    return toView(updated)
  }

  private async assertCanRead(actor: WorkspaceActor, workspaceId: string): Promise<void> {
    const scope = await this.access.resolve(actor, workspaceId)
    if (!canReadCommittees(actor, scope.membership)) throw CommitteeErrors.readForbidden()
  }

  // The right is checked first (nothing is told to whoever may not manage), then read again once the
  // workspace row is locked.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<void> {
    await lockWorkspaceRow(tx, workspaceId)
    await this.access.assertCanManage(actor, workspaceId, tx)
  }

  // The committee of this workspace, read after the lock, at the version the client saw.
  private async lockCommittee(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
    version: number,
  ): Promise<Committee> {
    await this.lockForManager(tx, actor, workspaceId)
    const current = await tx.committee.findFirst({ where: { id: committeeId, workspaceId } })
    if (!current) throw CommitteeErrors.notFound()
    if (current.version !== version) throw CommitteeErrors.changed(current.version)
    return current
  }
}

// The columns a manager's input gives, the instant its schedule designates resolved with the API's
// time zone data — the authority, even if the site validated the same rule with its own.
function scheduled(input: CommitteeInput) {
  const resolved = resolveZonedTime(input.date, input.time, input.timeZone)
  if (resolved.kind !== 'exact') {
    throw CommitteeErrors.schedule(zonedTimeIssue(input.date, input.time, input.timeZone)!)
  }
  return {
    name: input.name,
    localStart: wallClock(input.date, input.time),
    timeZone: input.timeZone,
    startsAt: resolved.instant,
    location: input.location ?? null,
    meetingUrl: input.meetingUrl ?? null,
    internalNotes: input.internalNotes ?? null,
  }
}

// A wall-clock time without zone, held in a Date by its UTC fields (how Prisma reads and writes a
// `timestamp without time zone`).
function wallClock(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`)
}

function changedFields(
  current: Committee,
  next: ReturnType<typeof scheduled> & {
    sharedInfo: string | null
    participationRequestsOpen: boolean
  },
): Field[] {
  const fields: Field[] = []
  if (current.name !== next.name) fields.push('name')
  if (
    current.localStart.getTime() !== next.localStart.getTime() ||
    current.timeZone !== next.timeZone ||
    current.startsAt.getTime() !== next.startsAt.getTime()
  ) {
    fields.push('schedule')
  }
  if (current.location !== next.location) fields.push('location')
  if (current.meetingUrl !== next.meetingUrl) fields.push('meetingUrl')
  if (current.internalNotes !== next.internalNotes) fields.push('internalNotes')
  if (current.sharedInfo !== next.sharedInfo) fields.push('sharedInfo')
  if (current.participationRequestsOpen !== next.participationRequestsOpen) {
    fields.push('participationRequestsOpen')
  }
  return fields
}
