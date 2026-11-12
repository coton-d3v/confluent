import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Committee, Prisma } from '@prisma/client'
import {
  COMMITTEE_FOLLOW_UP_LIMITS,
  NOTIFIED_COMMITTEE_APPLICATION_STATUSES,
  committeeNoticeStateOf,
  type CommitteeNoticeAudience,
  type CommitteeNoticeKind,
  type CommitteeNoticeState,
} from '@confluent/shared'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import {
  EMAIL_TRANSPORT,
  type CommitteeMoment,
  type EmailTransport,
} from '../auth/email/email-transport'
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

// What a change recorded, for its sender after the transaction.
export interface NoticeBatch {
  ids: string[]
  kind: CommitteeNoticeKind
  workspaceName: string
  committee: CommitteeMoment & { name: string }
  previous: CommitteeMoment | null
}

// Emails sent at once by one batch.
const SENDING_AT_ONCE = 4

// ROADMAP E08.06: who is told of a committee's new date, cancellation or restoration, and what became
// of each email (rules in @confluent/shared `committee-follow-up.schema.ts`).
//
// `recordIn` runs inside the manager's change (`CommitteesService`), after its write, under the locks
// it holds — the workspace's row (which decisions on participation requests and membership writes
// take first) and the committee's (which entries on it hold while they change, E08.03): the
// recipients are the people concerned by the committee as the change leaves it, none added or lost
// meanwhile. One row per person (`to_send`), at the committee's new version, unique: the change
// commits with its notices or not at all. A notice of an earlier change still unsent to the same
// person is superseded — they are told the committee as it last became.
//
// `deliver` runs after the commit and never throws (an SMTP failure never undoes nor blocks the
// change): each notice is claimed (`to_send` → `sending`, conditional: never sent twice, even by two
// senders, nor once superseded), sent, then recorded `sent` or `failed`. A crash in between leaves
// `to_send` or `sending`, shown to the managers as not confirmed.
@Injectable()
export class CommitteeNoticesService {
  private readonly logger = new Logger(CommitteeNoticesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async recordIn(
    tx: Prisma.TransactionClient,
    args: {
      workspace: { id: string; name: string }
      before: Committee
      after: Committee
      kind: CommitteeNoticeKind
    },
  ): Promise<NoticeBatch | null> {
    const { workspace, before, after, kind } = args
    const recipients = await recipientsOf(tx, after)
    if (recipients.size === 0) return null
    const now = new Date()
    const people = [...recipients.keys()]
    await tx.committeeNotice.updateMany({
      where: { committeeId: after.id, recipientId: { in: people }, state: 'to_send' },
      data: { state: 'superseded', stateAt: now },
    })
    const rows = people.map((recipientId) => ({
      id: randomUUID(),
      workspaceId: workspace.id,
      committeeId: after.id,
      committeeVersion: after.version,
      kind,
      recipientId,
      applicationId: recipients.get(recipientId)!.applicationId,
      participationRequestId: recipients.get(recipientId)!.participationRequestId,
      state: 'to_send',
      stateAt: now,
    }))
    await tx.committeeNotice.createMany({ data: rows })
    const moment = ({ date, time, timeZone }: CommitteeMoment) => ({ date, time, timeZone })
    return {
      ids: rows.map((r) => r.id),
      kind,
      workspaceName: workspace.name,
      committee: { name: after.name, ...moment(scheduleOf(after)) },
      previous: kind === 'rescheduled' ? moment(scheduleOf(before)) : null,
    }
  }

  async deliver(batch: NoticeBatch): Promise<void> {
    const pending = [...batch.ids]
    const worker = async () => {
      for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
        await this.deliverOne(batch, id)
      }
    }
    await Promise.all(Array.from({ length: Math.min(SENDING_AT_ONCE, pending.length) }, worker))
  }

  // The notices of one committee, the latest change first, as its managers read them: who (the
  // request on the agenda or the participant's request — never an address) and what became of the
  // email. The caller checked the managers' right.
  async listForCommittee(workspaceId: string, committeeId: string): Promise<CommitteeNoticeView[]> {
    const notices = await this.prisma.committeeNotice.findMany({
      where: { committeeId, workspaceId },
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
        committeeVersion: n.committeeVersion,
        kind: n.kind as CommitteeNoticeKind,
        audience,
        label:
          (n.applicationId
            ? applicationLabel.get(n.applicationId)
            : requestLabel.get(n.participationRequestId ?? '')) ?? 'Destinataire',
        state: committeeNoticeStateOf(n.state),
        stateAt: n.stateAt,
        createdAt: n.createdAt,
      }
    })
  }

  private async deliverOne(batch: NoticeBatch, id: string): Promise<void> {
    try {
      const claimed = await this.prisma.committeeNotice.updateMany({
        where: { id, state: 'to_send' },
        data: { state: 'sending', stateAt: new Date() },
      })
      if (claimed.count !== 1) return
      const notice = await this.prisma.committeeNotice.findUnique({ where: { id } })
      const recipient = notice
        ? await this.prisma.user.findUnique({ where: { id: notice.recipientId } })
        : null
      if (!notice || !recipient) return
      let sent = true
      try {
        await this.email.sendCommitteeChanged({
          to: recipient.email,
          kind: batch.kind,
          audience: notice.applicationId ? 'entrepreneur' : 'participant',
          workspaceName: batch.workspaceName,
          committee: batch.committee,
          previous: batch.previous,
          signInUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/auth`,
          locale: 'fr',
        })
      } catch (err) {
        sent = false
        this.logger.warn(`committee notice not sent (notice ${id}): ${(err as Error).message}`)
      }
      await this.prisma.committeeNotice.updateMany({
        where: { id, state: 'sending' },
        data: { state: sent ? 'sent' : 'failed', stateAt: new Date() },
      })
    } catch (err) {
      // The change is recorded; the notice stays `to_send` or `sending` (« non confirmé »).
      this.logger.warn(
        `committee notice state not recorded (notice ${id}): ${(err as Error).message}`,
      )
    }
  }
}

// Who is concerned by a committee, one entry per account: the owner of each request it brings
// (entries applied, proposed or accepted, E08.03 — the account owning the request now) and each
// participant (`acceptedParticipations`, active only). The first reason found is kept for each.
async function recipientsOf(
  tx: Prisma.TransactionClient,
  committee: Committee,
): Promise<Map<string, { applicationId: string | null; participationRequestId: string | null }>> {
  const recipients = new Map<
    string,
    { applicationId: string | null; participationRequestId: string | null }
  >()
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
        recipients.set(owner, { applicationId: entry.id, participationRequestId: null })
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
      })
  }
  return recipients
}
