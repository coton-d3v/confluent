import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  EXPORT_FORMAT,
  EXPORT_LIMITS,
  OAUTH_SCOPE_LABELS,
  notificationKindOf,
  type PersonalDataExport,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CompaniesService } from '../companies/companies.service'
import { notificationText } from '../notifications/notification-payloads'
import { PositionsService } from '../opportunities/positions.service'

type Db = Prisma.TransactionClient
type Person = { id: string; email: string; role: string }

const EXPORT_TIMEOUT_MS = 60_000
const iso = (d: Date) => d.toISOString()
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null)

export class ExportLimitReached extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        code: 'EXPORT_LIMIT_REACHED',
        message: `Vous avez déjà téléchargé vos données ${EXPORT_LIMITS.perAccount} fois dans l’heure : réessayez dans quelques minutes.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}

// ROADMAP E10.10 — the signed-in person's data, as one JSON document (rules in @confluent/shared
// `privacy.schema.ts`, shape `personalDataExportSchema`). Only what is theirs, read from their
// account alone — never an identifier taken from the client: the companies they hold
// (`CompaniesService.heldOnly`, a company prepared for a structure excepted) and their requests, the
// shares they gave and those addressed to their address (a request's name only while the share is
// active: the name its recipient reads), their positions as « Mes positionnements » shows them
// (`PositionsService.mine`, the opportunities' rule), their memberships, notifications (the texts the
// site shows them), connected applications, journal entries they made (the action, when, through
// which application, their own network details — never another entry's metadata) and readings.
//
// Limited per account, under an advisory lock (R67): the count of the last hour's exports and the
// new entry are written in the same transaction, which builds the document — a failure records
// nothing and uses nothing of the limit.
@Injectable()
export class PersonalDataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly positions: PositionsService,
  ) {}

  async export(user: Person, now: Date = new Date()): Promise<PersonalDataExport> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`personal-data-export:${user.id}`}, 0))`
        const since = new Date(now.getTime() - EXPORT_LIMITS.windowMinutes * 60_000)
        const recent = await tx.auditLog.findMany({
          where: {
            actorId: user.id,
            actionType: 'personal_data_exported',
            createdAt: { gt: since },
          },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        if (recent.length >= EXPORT_LIMITS.perAccount) {
          const freed = recent[0].createdAt.getTime() + EXPORT_LIMITS.windowMinutes * 60_000
          throw new ExportLimitReached(Math.max(1, Math.ceil((freed - now.getTime()) / 1000)))
        }
        const document = await this.build(tx, user, now)
        await this.audit.recordIn(tx, {
          actionType: 'personal_data_exported',
          actorId: user.id,
          metadata: { format: EXPORT_FORMAT },
        })
        return document
      },
      { timeout: EXPORT_TIMEOUT_MS },
    )
  }

  private async build(db: Db, user: Person, now: Date): Promise<PersonalDataExport> {
    const account = await db.user.findUnique({ where: { id: user.id } })
    if (!account) throw new Error('account vanished during its export')
    const [companies, sharesReceived, positions, memberships, notifications, grants] =
      await Promise.all([
        this.ownCompanies(db, user),
        this.sharesReceived(db, user),
        this.positions.mine(user),
        db.workspaceMembership.findMany({
          where: { userId: user.id },
          include: { workspace: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        db.notification.findMany({
          where: { recipientId: user.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        db.oAuthGrant.findMany({
          where: { userId: user.id },
          include: { client: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ])
    const [activity, readings, deletionRequests, workspaceNames] = await Promise.all([
      db.auditLog.findMany({
        where: { actorId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { actionType: true, createdAt: true, metadata: true },
      }),
      db.readingSession.findMany({
        where: { readerId: user.id },
        orderBy: { startedAt: 'asc' },
      }),
      db.accountDeletionRequest.findMany({
        where: { userId: user.id },
        orderBy: { requestedAt: 'asc' },
      }),
      this.workspaceNames(
        db,
        grants.flatMap((g) => g.workspaceIds),
      ),
    ])

    return {
      format: EXPORT_FORMAT,
      exportedAt: iso(now),
      account: {
        id: account.id,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        locale: account.locale,
        createdAt: iso(account.createdAt),
        emailVerifiedAt: isoOrNull(account.emailVerifiedAt),
      },
      companies,
      sharesReceived,
      investorPositions: positions.items
        .filter((item) => item.interest || item.pledge || item.disclosures.length > 0)
        .map((item) => ({
          requestName: item.dossier?.name ?? null,
          interest: item.interest
            ? { nameVisible: item.interest.nameVisible, markedAt: dateOf(item.interest.markedAt) }
            : null,
          pledge: item.pledge
            ? {
                intention: item.pledge.intention,
                amountEur: item.pledge.amountEur,
                comment: item.pledge.comment ?? null,
                showName: item.pledge.showName,
                showAmount: item.pledge.showAmount,
                updatedAt: dateOf(item.pledge.updatedAt),
              }
            : null,
          shownToStructures: item.disclosures.map((d) => d.workspace.name),
        })),
      workspaceMemberships: memberships.map((m) => ({
        workspaceName: m.workspace.name,
        role: m.role,
        organization: m.organization,
        canManageWorkspace: m.canManageWorkspace,
        invitedAt: iso(m.createdAt),
        deactivatedAt: isoOrNull(m.deactivatedAt),
      })),
      notifications: notifications.flatMap((n) => {
        const kind = notificationKindOf(n.kind)
        if (!kind) return []
        const text = notificationText(kind, n.payload)
        return [
          {
            title: text.title,
            body: text.body,
            createdAt: iso(n.createdAt),
            readAt: isoOrNull(n.readAt),
          },
        ]
      }),
      connectedApplications: grants.map((g) => ({
        application: g.client.name,
        permissions: g.scopes.map((s) => OAUTH_SCOPE_LABELS[s] ?? s),
        workspaces: g.workspaceIds.map((id) => workspaceNames.get(id)).filter(isString),
        authorizedAt: iso(g.createdAt),
        lastUsedAt: isoOrNull(g.lastUsedAt),
        expiresAt: iso(g.expiresAt),
        revokedAt: isoOrNull(g.revokedAt),
      })),
      activity: activity.map((entry) => {
        const meta = (entry.metadata ?? {}) as Record<string, unknown>
        return {
          action: entry.actionType,
          at: iso(entry.createdAt),
          application: stringOrNull(meta.clientName),
          tool: entry.actionType === 'mcp_tool_called' ? stringOrNull(meta.tool) : null,
          ip: stringOrNull(meta.ip),
          userAgent: stringOrNull(meta.userAgent),
        }
      }),
      readings: readings.map((r) => ({
        channel: r.channel,
        startedAt: iso(r.startedAt),
        lastSeenAt: iso(r.lastSeenAt),
        activeSeconds: r.activeMs === null ? null : Math.round(r.activeMs / 1000),
      })),
      deletionRequests: deletionRequests.map((d) => ({
        status: d.status,
        requestedAt: iso(d.requestedAt),
        decidedAt: isoOrNull(d.decidedAt),
        declineNote: d.declineNote,
      })),
    }
  }

  // The companies the account holds as their owner — never one a conseiller prepares for a
  // structure: held for it, it is the future owner's —, with their profile, library and requests.
  private async ownCompanies(db: Db, user: Person): Promise<PersonalDataExport['companies']> {
    const rows = await db.company.findMany({
      where: { ownerId: user.id, preparedInWorkspaceId: null },
      orderBy: { createdAt: 'asc' },
    })
    const held = await this.companies.heldOnly(user, rows)
    const companyIds = held.map((c) => c.id)
    if (companyIds.length === 0) return []
    const [answers, library, versions, dossiers] = await Promise.all([
      db.dossierAnswer.findMany({ where: { companyId: { in: companyIds } } }),
      db.libraryDocument.findMany({
        where: { companyId: { in: companyIds } },
        orderBy: { createdAt: 'asc' },
      }),
      db.document.findMany({
        where: { companyId: { in: companyIds } },
        orderBy: { version: 'asc' },
      }),
      db.dossier.findMany({
        where: { companyId: { in: companyIds }, userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const dossierIds = dossiers.map((d) => d.id)
    const [shares, candidatures] = await Promise.all([
      db.shareLink.findMany({
        where: { dossierId: { in: dossierIds } },
        orderBy: { createdAt: 'asc' },
      }),
      db.candidature.findMany({
        where: { dossierId: { in: dossierIds } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const candidatureAnswers = await db.candidatureAnswer.findMany({
      where: { candidatureId: { in: candidatures.map((c) => c.id) } },
    })
    const fieldIds = [...new Set([...answers, ...candidatureAnswers].map((a) => a.fieldId))]
    const [fields, workspaceNames] = await Promise.all([
      db.questionnaireField.findMany({
        where: { id: { in: fieldIds } },
        select: { id: true, label: true },
      }),
      this.workspaceNames(
        db,
        candidatures.map((c) => c.workspaceId),
      ),
    ])
    const labelOf = new Map(fields.map((f) => [f.id, f.label] as const))
    const answerView = (a: { fieldId: string; value: string; updatedAt: Date }) => ({
      question: labelOf.get(a.fieldId) ?? a.fieldId,
      value: a.value,
      updatedAt: iso(a.updatedAt),
    })

    return held.map((company) => ({
      id: company.id,
      name: company.name,
      createdAt: iso(company.createdAt),
      profileAnswers: answers.filter((a) => a.companyId === company.id).map(answerView),
      documents: library
        .filter((d) => d.companyId === company.id)
        .map((d) => ({
          filename: d.filename,
          type: d.type,
          versions: versions
            .filter((v) => v.libraryDocumentId === d.id)
            .map((v) => ({
              version: v.version,
              mimetype: v.mimetype,
              size: v.size,
              createdAt: iso(v.createdAt),
            })),
        })),
      requests: dossiers
        .filter((d) => d.companyId === company.id)
        .map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          summary: d.summary,
          objective: d.objective,
          description: d.description,
          amountEur: d.amountEur,
          financingTypes: d.financingTypes,
          publicationStatus: d.publicationStatus,
          submittedAt: isoOrNull(d.submittedAt),
          createdAt: iso(d.createdAt),
          sharesGiven: shares
            .filter((s) => s.dossierId === d.id)
            .map((s) => ({
              recipientEmail: s.recipientEmail,
              accessLevel: s.accessLevel,
              status: s.status,
              createdAt: iso(s.createdAt),
              revokedAt: isoOrNull(s.revokedAt),
            })),
          candidatures: candidatures
            .filter((c) => c.dossierId === d.id)
            .map((c) => ({
              workspaceName: workspaceNames.get(c.workspaceId) ?? '',
              financingStatus: c.financingStatus,
              submittedAt: isoOrNull(c.submittedAt),
              createdAt: iso(c.createdAt),
              answers: candidatureAnswers.filter((a) => a.candidatureId === c.id).map(answerView),
            })),
        })),
    }))
  }

  // The shares addressed to the account's address (whole value, without case: as the shares are
  // read everywhere). The request's name only while the share is active — what its recipient reads
  // now —; nothing else of the request, never its owner's data.
  private async sharesReceived(
    db: Db,
    user: Person,
  ): Promise<PersonalDataExport['sharesReceived']> {
    const links = await db.shareLink.findMany({
      where: { recipientEmail: { equals: user.email, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    })
    const mine = links.filter(
      (l) => l.recipientEmail.trim().toLowerCase() === user.email.trim().toLowerCase(),
    )
    const activeIds = [
      ...new Set(mine.filter((l) => l.status === 'active').map((l) => l.dossierId)),
    ]
    const names = new Map(
      (
        await db.dossier.findMany({
          where: { id: { in: activeIds } },
          select: { id: true, name: true },
        })
      ).map((d) => [d.id, d.name] as const),
    )
    return mine.map((l) => ({
      requestName: l.status === 'active' ? (names.get(l.dossierId) ?? null) : null,
      accessLevel: l.accessLevel,
      status: l.status,
      createdAt: iso(l.createdAt),
      revokedAt: isoOrNull(l.revokedAt),
    }))
  }

  private async workspaceNames(db: Db, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const rows = await db.workspace.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(rows.map((w) => [w.id, w.name] as const))
  }
}

const isString = (v: unknown): v is string => typeof v === 'string'
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const dateOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString())
