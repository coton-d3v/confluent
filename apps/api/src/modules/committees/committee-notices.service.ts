import { Injectable } from '@nestjs/common'
import type { Committee, Prisma } from '@prisma/client'
import {
  COMMITTEE_FOLLOW_UP_LIMITS,
  COMMITTEE_NOTIFICATION_KINDS,
  NOTIFIED_COMMITTEE_APPLICATION_STATUSES,
  committeeNoticeKindOfNotification,
  committeeNoticeStateOf,
  type CommitteeNoticeAudience,
  type CommitteeNoticeKind,
  type CommitteeNoticeState,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { acceptedParticipations } from './committee-participants'
import { scheduleOf } from './committee-views'

// @confluent/shared `committeeNoticeSchema`.
export interface CommitteeNoticeView {
  id: string
  committeeVersion: number
  kind: CommitteeNoticeKind
  audience: CommitteeNoticeAudience
  label: string
  state: CommitteeNoticeState
  stateAt: Date
  createdAt: Date
}

const COMMITTEE_KINDS = { in: Object.values(COMMITTEE_NOTIFICATION_KINDS) }

// ROADMAP E08.06: who is told of a committee's new date, cancellation or restoration, and what became
// of each email (rules in @confluent/shared `committee-follow-up.schema.ts`) — since E10.03, as
// notifications (`NotificationsService`: in the site too, same claim of each email).
//
// `recordIn` runs inside the manager's change (`CommitteesService`), after its write, under the locks
// it holds — the workspace's row (which decisions on participation requests and membership writes
// take first) and the committee's (which entries on it hold while they change, E08.03): the
// recipients are the people concerned by the committee as the change leaves it, none added or lost
// meanwhile. One notification per person, at the committee's new version, unique: the change commits
// with its notifications or not at all. One about an earlier change still unsent to the same person
// is superseded — they are told the committee as it last became. It returns the emails to send after
// the commit (`NotificationsService.deliver`, which never throws).
@Injectable()
export class CommitteeNoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async recordIn(
    tx: Prisma.TransactionClient,
    args: {
      workspace: { id: string; name: string }
      before: Committee
      after: Committee
      kind: CommitteeNoticeKind
    },
  ): Promise<string[]> {
    const { workspace, before, after, kind } = args
    const recipients = await recipientsOf(tx, after)
    if (recipients.size === 0) return []
    const schedule = scheduleOf(after)
    const previous = scheduleOf(before)
    return this.notifications.recordIn(
      tx,
      [...recipients].map(([recipientId, why]) => ({
        recipientId,
        kind: COMMITTEE_NOTIFICATION_KINDS[kind],
        key: `committee_changed:${after.id}:${after.version}`,
        subject: `committee:${after.id}`,
        workspaceId: workspace.id,
        committee: {
          id: after.id,
          version: after.version,
          applicationId: why.applicationId,
          participationRequestId: why.participationRequestId,
        },
        payload: {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          committeeName: after.name,
          date: schedule.date,
          time: schedule.time,
          timeZone: schedule.timeZone,
          previous:
            kind === 'rescheduled'
              ? { date: previous.date, time: previous.time, timeZone: previous.timeZone }
              : null,
          // Told as the owner of a request on the agenda first: what the managers know them by.
          audience: why.applicationId ? 'entrepreneur' : 'participant',
          candidatureId: why.candidatureId,
        },
      })),
    )
  }

  async deliver(ids: string[]): Promise<void> {
    await this.notifications.deliver(ids)
  }

  // The notices of one committee, the latest change first, as its managers read them: who (the
  // request on the agenda or the participant's request — never an address) and what became of the
  // email. The caller checked the managers' right.
  async listForCommittee(workspaceId: string, committeeId: string): Promise<CommitteeNoticeView[]> {
    const notices = await this.prisma.notification.findMany({
      where: { committeeId, workspaceId, kind: COMMITTEE_KINDS },
      orderBy: [{ committeeVersion: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: COMMITTEE_FOLLOW_UP_LIMITS.noticesListed,
    })
    if (notices.length === 0) return []
    const applications = await this.prisma.committeeApplication.findMany({
      where: { id: { in: notices.flatMap((n) => (n.applicationId ? [n.applicationId] : [])) } },
    })
    const candidatures = await this.prisma.candidature.findMany({
      where: { id: { in: applications.map((a) => a.candidatureId) } },
    })
    const dossiers = await this.prisma.dossier.findMany({
      where: { id: { in: candidatures.map((c) => c.dossierId) } },
    })
    const [companies, requests] = await Promise.all([
      this.prisma.company.findMany({ where: { id: { in: dossiers.map((d) => d.companyId) } } }),
      this.prisma.participationRequest.findMany({
        where: {
          id: {
            in: notices.flatMap((n) =>
              n.participationRequestId ? [n.participationRequestId] : [],
            ),
          },
        },
      }),
    ])
    const requestLabel = new Map(
      requests.map((r) => [r.id, r.organization ? `${r.name} · ${r.organization}` : r.name]),
    )
    const applicationLabel = new Map(
      applications.map((a) => {
        const candidature = candidatures.find((c) => c.id === a.candidatureId)
        const dossier = dossiers.find((d) => d.id === candidature?.dossierId)
        const company = companies.find((c) => c.id === dossier?.companyId)
        return [a.id, dossier && company ? `${company.name} — ${dossier.name}` : 'Demande inscrite']
      }),
    )
    return notices.map((n) => {
      // Told as the owner of a request on the agenda first: what the managers know them by.
      const audience: CommitteeNoticeAudience = n.applicationId ? 'entrepreneur' : 'participant'
      return {
        id: n.id,
        committeeVersion: n.committeeVersion ?? 1,
        kind: committeeNoticeKindOfNotification(n.kind)!,
        audience,
        label:
          (n.applicationId
            ? applicationLabel.get(n.applicationId)
            : requestLabel.get(n.participationRequestId ?? '')) ?? 'Destinataire',
        state: committeeNoticeStateOf(n.emailState),
        stateAt: n.emailStateAt,
        createdAt: n.createdAt,
      }
    })
  }
}

interface Reason {
  applicationId: string | null
  participationRequestId: string | null
  candidatureId: string | null
}

// Who is concerned by a committee, one entry per account: the owner of each request it brings
// (entries applied, proposed or accepted, E08.03 — the account owning the request now) and each
// participant (`acceptedParticipations`, active only). The first reason found is kept for each.
async function recipientsOf(
  tx: Prisma.TransactionClient,
  committee: Committee,
): Promise<Map<string, Reason>> {
  const recipients = new Map<string, Reason>()
  const entries = await tx.committeeApplication.findMany({
    where: {
      committeeId: committee.id,
      workspaceId: committee.workspaceId,
      status: { in: [...NOTIFIED_COMMITTEE_APPLICATION_STATUSES] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (entries.length > 0) {
    const candidatures = await tx.candidature.findMany({
      where: { id: { in: entries.map((e) => e.candidatureId) } },
    })
    const dossiers = await tx.dossier.findMany({
      where: { id: { in: candidatures.map((c) => c.dossierId) } },
    })
    for (const entry of entries) {
      const candidature = candidatures.find((c) => c.id === entry.candidatureId)
      const owner = dossiers.find((d) => d.id === candidature?.dossierId)?.userId
      if (owner && !recipients.has(owner)) {
        recipients.set(owner, {
          applicationId: entry.id,
          participationRequestId: null,
          candidatureId: entry.candidatureId,
        })
      }
    }
  }
  const participations = await acceptedParticipations(tx, committee.workspaceId, {
    committeeIds: [committee.id],
  })
  for (const { request, active } of participations) {
    if (!active || !request.memberUserId) continue
    const known = recipients.get(request.memberUserId)
    if (known) known.participationRequestId ??= request.id
    else
      recipients.set(request.memberUserId, {
        applicationId: null,
        participationRequestId: request.id,
        candidatureId: null,
      })
  }
  return recipients
}
