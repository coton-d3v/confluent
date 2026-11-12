import type { ParticipationRequest, Prisma } from '@prisma/client'
import { isActiveMembership } from '../workspaces/workspace-access'

// THE participants of a workspace's committees (ROADMAP E08.06), read in one place: a participation
// request a manager accepted (E08.05) for that session, whose admitted account (`member_user_id`,
// never matched by address) is still an active member of the workspace. A request accepted for an
// account since deactivated, removed or deleted makes no participant: it reads nothing of the
// committee and is told nothing (closed by default). `db`: inside a transaction, after its locks.
export interface Participation {
  committeeId: string
  request: ParticipationRequest
  // The admitted account is still an active member of the workspace.
  active: boolean
}

export async function acceptedParticipations(
  db: Prisma.TransactionClient,
  workspaceId: string,
  filter: { committeeIds?: string[]; memberUserId?: string } = {},
): Promise<Participation[]> {
  const requests = await db.participationRequest.findMany({
    where: {
      workspaceId,
      status: 'accepted',
      ...(filter.memberUserId !== undefined && { memberUserId: filter.memberUserId }),
    },
    orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
  })
  if (requests.length === 0) return []
  const links = await db.participationRequestCommittee.findMany({
    where: {
      workspaceId,
      requestId: { in: requests.map((r) => r.id) },
      ...(filter.committeeIds && { committeeId: { in: filter.committeeIds } }),
    },
  })
  const members = [...new Set(requests.flatMap((r) => (r.memberUserId ? [r.memberUserId] : [])))]
  const memberships =
    members.length === 0
      ? []
      : await db.workspaceMembership.findMany({ where: { workspaceId, userId: { in: members } } })
  const active = new Set(memberships.filter(isActiveMembership).map((m) => m.userId))
  const byId = new Map(requests.map((r) => [r.id, r]))
  return links.flatMap((link) => {
    const request = byId.get(link.requestId)
    if (!request) return []
    return [
      {
        committeeId: link.committeeId,
        request,
        active: request.memberUserId !== null && active.has(request.memberUserId),
      },
    ]
  })
}
