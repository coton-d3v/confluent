import { Injectable } from '@nestjs/common'
import {
  COMMITTEE_APPLICATION_STATUSES,
  committeeApplicationStatusOf,
  participantCommitteeOf,
  type CommitteeApplicationStatus,
  type CommitteeParticipantAccess,
  type CommitteeSharedField,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { CommitteeErrors } from './committee-errors'
import { CommitteeNoticesService, type CommitteeNoticeView } from './committee-notices.service'
import { acceptedParticipations } from './committee-participants'
import { toView, type CommitteeView } from './committee-views'
import { CommitteesService } from './committees.service'

// @confluent/shared `committeeProgressSchema`.
export interface CommitteeProgressView {
  committeeId: string
  applications: Record<CommitteeApplicationStatus, number>
  participants: { accepted: number; pending: number }
}

// @confluent/shared `committeeParticipantSchema`.
export interface CommitteeParticipantView {
  requestId: string
  name: string
  organization: string | null
  email: string
  decidedAt: Date | null
  access: CommitteeParticipantAccess
}

// ROADMAP E08.06: the lists each audience reads of a workspace's committees, and their progress
// (rules in @confluent/shared `committee-follow-up.schema.ts`).
//
//  * Progress — counts of the entries on each committee by status, and of its participants
//    (accepted and still members, or waiting for a decision): the committees' readers
//    (`CommitteesService` read rule: active conseillers and administrators; `403` investisseur).
//  * Participants by name, and the notices sent: the workspace's managers (`canManageWorkspace`,
//    who decide the participation requests; `403` other members).
//  * A participant's sessions: the committees of the workspace the signed-in account was accepted
//    for and still is an active member of, as their shared view (link included); nothing of the
//    agenda nor of the other participants; an empty list for anyone else in the workspace.
// Outside the workspace, the guard's `404` comes first. No MCP tool (E08.07).
@Injectable()
export class CommitteeFollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly committees: CommitteesService,
    private readonly notices: CommitteeNoticesService,
  ) {}

  async progress(actor: WorkspaceActor, workspaceId: string): Promise<CommitteeProgressView[]> {
    const committees = await this.committees.list(actor, workspaceId)
    const [entries, links] = await Promise.all([
      this.prisma.committeeApplication.findMany({ where: { workspaceId } }),
      this.prisma.participationRequestCommittee.findMany({ where: { workspaceId } }),
    ])
    const pendingRequests = new Set(
      (
        await this.prisma.participationRequest.findMany({
          where: { workspaceId, status: 'pending' },
        })
      ).map((r) => r.id),
    )
    const participations = await acceptedParticipations(this.prisma, workspaceId)
    return committees.map((committee) => {
      const applications = Object.fromEntries(
        COMMITTEE_APPLICATION_STATUSES.map((s) => [s, 0]),
      ) as Record<CommitteeApplicationStatus, number>
      for (const entry of entries) {
        if (entry.committeeId === committee.id) {
          applications[committeeApplicationStatusOf(entry.status)] += 1
        }
      }
      return {
        committeeId: committee.id,
        applications,
        participants: {
          accepted: participations.filter((p) => p.committeeId === committee.id && p.active).length,
          pending: links.filter(
            (l) => l.committeeId === committee.id && pendingRequests.has(l.requestId),
          ).length,
        },
      }
    })
  }

  // The accepted requests for one committee, the earliest decision first, with whether their
  // account still is an active member (an inactive one reads nothing and is told nothing).
  async participants(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
  ): Promise<CommitteeParticipantView[]> {
    await this.assertManagedCommittee(actor, workspaceId, committeeId)
    const participations = await acceptedParticipations(this.prisma, workspaceId, {
      committeeIds: [committeeId],
    })
    return participations
      .sort(
        (a, b) =>
          (a.request.decidedAt?.getTime() ?? 0) - (b.request.decidedAt?.getTime() ?? 0) ||
          a.request.id.localeCompare(b.request.id),
      )
      .map(({ request, active }) => ({
        requestId: request.id,
        name: request.name,
        organization: request.organization,
        email: request.email,
        decidedAt: request.decidedAt,
        access: active ? 'active' : 'inactive',
      }))
  }

  async noticesOf(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
  ): Promise<CommitteeNoticeView[]> {
    await this.assertManagedCommittee(actor, workspaceId, committeeId)
    return this.notices.listForCommittee(workspaceId, committeeId)
  }

  // The committees the signed-in account takes part in, in this workspace, earliest first.
  async sessions(
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<Array<Pick<CommitteeView, CommitteeSharedField>>> {
    const scope = await this.access.resolve(actor, workspaceId)
    // An administrator outside the workspace is no participant of it.
    if (!scope.membership) return []
    const participations = await acceptedParticipations(this.prisma, workspaceId, {
      memberUserId: actor.id,
    })
    const ids = [...new Set(participations.filter((p) => p.active).map((p) => p.committeeId))]
    if (ids.length === 0) return []
    const committees = await this.prisma.committee.findMany({
      where: { workspaceId, id: { in: ids } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    })
    return committees.map((c) => participantCommitteeOf(toView(c)))
  }

  private async assertManagedCommittee(
    actor: WorkspaceActor,
    workspaceId: string,
    committeeId: string,
  ): Promise<void> {
    await this.access.assertCanManage(actor, workspaceId)
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, workspaceId },
    })
    if (!committee) throw CommitteeErrors.notFound()
  }
}
