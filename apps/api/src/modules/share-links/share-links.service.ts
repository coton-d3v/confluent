import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import type { Dossier, Prisma, ShareLink } from '@prisma/client'
import { grantsAccess, isArchived, type AccessLevel, type ShareRevokedBy } from '@confluent/shared'
import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { AuthService } from '../auth/auth.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { DossiersService, lockDossier, requestArchived } from '../dossiers/dossiers.service'
import { DocumentsService, type DocumentGroup } from '../documents/documents.service'
import { fieldVisibleAt, grantedLevel, presentationForShare } from '../dossiers/financeur-access'

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// What the recipient of a share reads at a level, whatever the way they reach it (E07.01).
export interface RecipientView {
  dossier: {
    id: string
    name: string
    slug: string
    sector: string | null
    maturityStage: string | null
    ancrageCvl: string | null
    tagTechnologique: string | null
    axe1Projet: number | null
    axe2Financier: number | null
    axe3Origine: number | null
    deeptechScore: number | null
    preCreation: boolean | null
    // E05.07: the request's presentation, empty unless it is published.
    summary: string | null
    objective: string | null
    description: string | null
    amountEur: number | null
    financingTypes: string[]
    publicationStatus: string
    publishedAt: Date | null
  }
  // Already filtered by the level: hidden fields and their answers never leave the server.
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
  answers: Array<{ fieldId: string; value: string }>
  // Only the documents the dossier selects, at the version selected (E05.07), that the level may
  // read: an attachment follows its field's level, any other document requires `complet` (E03.11).
  documents: DocumentGroup[]
}

export interface FinanceurShareResponse extends RecipientView {
  share: { recipientEmail: string; status: string; accessLevel: AccessLevel }
}

// E07.01 « Voir comme le destinataire ».
export interface SharePreview extends RecipientView {
  preview: { accessLevel: AccessLevel; totalQuestions: number; totalDocuments: number }
}

// One entry of the list of accesses, with who revoked it (E07.01).
export type ShareAccess = ShareLink & { revokedBy: ShareRevokedBy | null }

// Who acts on a share besides its recipient: the request's owner — whoever holds its company,
// checked by `DossiersService` — or an administrator (role read from the database at each request,
// `AdminGuard`). A workspace's conseillers and managers never reach a request's shares: a share is
// the owner's own diffusion, apart from what is presented to a structure (E05.09, E07.02).
export type ShareActor = { id: string; as: 'owner' | 'admin' }

const REVOCATION_ACTIONS = {
  share_link_revoked: 'owner',
  admin_revoked_share_link: 'admin',
} as const satisfies Record<string, ShareRevokedBy>

const linkNotFound = () =>
  new NotFoundException({ code: 'SHARE_LINK_NOT_FOUND', message: 'Share link not found.' })

const dossierNotFound = () =>
  new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })

@Injectable()
export class ShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly dossiers: DossiersService,
    private readonly documents: DocumentsService,
    private readonly auth: AuthService,
    private readonly questionnaires: QuestionnairesService,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  // E02.08: a share link opens the dossier only to the account it was sent to. A forwarded link
  // used by someone else — even logged in — gets nothing.
  assertRecipient(shareLink: ShareLink, user: { email: string }): void {
    if (!sameEmail(user.email, shareLink.recipientEmail)) {
      throw new ForbiddenException({
        message: 'This share link was sent to another email address.',
        details: { reason: 'recipient_mismatch' },
      })
    }
  }

  // Sends the usual magic link to the recipient — only if `email` is the recipient's address. The
  // caller always gets the same answer, so the endpoint does not reveal who the recipient is.
  async requestAccess(shareLink: ShareLink, email: string, req: Request): Promise<void> {
    const matched = sameEmail(email, shareLink.recipientEmail)
    if (matched) await this.auth.requestMagicLink(shareLink.recipientEmail)
    await this.audit.record({
      actionType: 'share_link_access_requested',
      shareLinkId: shareLink.id,
      dossierId: shareLink.dossierId,
      metadata: { matched, ip: req.ip ?? null },
    })
  }

  // The dossier at the level of this very link — not the highest across the recipient's links: the
  // token is what was shared, and it may have been forwarded.
  async resolveForFinanceur(shareLink: ShareLink): Promise<FinanceurShareResponse> {
    const dossier = await this.findDossier(shareLink.dossierId)
    const accessLevel = grantedLevel(shareLink.accessLevel)
    return {
      ...(await this.recipientView(dossier, accessLevel)),
      share: { recipientEmail: shareLink.recipientEmail, status: shareLink.status, accessLevel },
    }
  }

  // E07.01 « Voir comme le destinataire », for the request's owner: what a recipient at `level`
  // reads, through the same projection, without creating a link nor recording a view.
  async previewForOwner(dossierId: string, userId: string, level: AccessLevel) {
    return this.preview(await this.dossiers.getByIdForUser(dossierId, userId), level)
  }

  // The same preview for an administrator (`AdminGuard`), on any request.
  async previewForAdmin(dossierId: string, level: AccessLevel) {
    return this.preview(await this.findDossier(dossierId), level)
  }

  private async preview(dossier: Dossier, level: AccessLevel): Promise<SharePreview> {
    const [view, totalQuestions, everything] = await Promise.all([
      this.recipientView(dossier, level),
      this.prisma.questionnaireField.count({
        where: { versionId: dossier.questionnaireVersionId },
      }),
      level === 'complet'
        ? Promise.resolve(null)
        : this.documents.listForDossier(dossier, 'complet', 'share'),
    ])
    return {
      ...view,
      // A preview delivers no file: its owner reads the library, an administrator gains no download.
      documents: view.documents.map(withoutFile),
      preview: {
        accessLevel: level,
        totalQuestions,
        totalDocuments: (everything ?? view.documents).length,
      },
    }
  }

  // THE projection of a request for a share recipient at a level (E05.07, E07.01): the answers its
  // level may read, the classification it may read, the documents the dossier selects that it may
  // read and, once published, its presentation. Shared by the recipient's page and the preview, so
  // that what the owner previews is what a recipient reads.
  private async recipientView(dossier: Dossier, accessLevel: AccessLevel): Promise<RecipientView> {
    const [structure, answers] = await Promise.all([
      this.questionnaires.getVersion(dossier.questionnaireVersionId),
      this.prisma.dossierAnswer.findMany({
        where: { companyId: dossier.companyId },
        select: { fieldId: true, value: true },
      }),
    ])
    const row = presentationForShare(await this.dossiers.projectForLevel(dossier, accessLevel))
    const fields = (structure?.fields ?? []).filter((f) => fieldVisibleAt(f, accessLevel))
    const visibleIds = new Set(fields.map((f) => f.id))
    return {
      dossier: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        sector: row.sector,
        maturityStage: row.maturityStage,
        ancrageCvl: row.ancrageCvl,
        tagTechnologique: row.tagTechnologique,
        axe1Projet: row.axe1Projet,
        axe2Financier: row.axe2Financier,
        axe3Origine: row.axe3Origine,
        deeptechScore: row.deeptechScore,
        preCreation: row.preCreation,
        summary: row.summary,
        objective: row.objective,
        description: row.description,
        amountEur: row.amountEur,
        financingTypes: row.financingTypes,
        publicationStatus: row.publicationStatus,
        publishedAt: row.publishedAt,
      },
      // Only the sections that still contain a visible field.
      sections: (structure?.sections ?? []).filter((sec) =>
        fields.some((f) => f.sectionId === sec.id),
      ),
      fields,
      answers: answers
        .filter((a) => visibleIds.has(a.fieldId))
        .map((a) => ({ fieldId: a.fieldId, value: a.value })),
      documents: await this.documents.listForDossier(dossier, accessLevel, 'share'),
    }
  }

  async recordView(shareLink: ShareLink, req: Request): Promise<void> {
    await this.audit.record({
      actionType: 'share_link_viewed',
      shareLinkId: shareLink.id,
      dossierId: shareLink.dossierId,
      metadata: {
        recipientEmail: shareLink.recipientEmail,
        userAgent: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
      },
    })
  }

  // The owner invites a recipient at the level they choose (E07.01). A diffusion: never while a
  // conseiller prepares the company (409, E05.08), never on an archived request (409, E06.01: a
  // closed request is not diffused further; its existing shares stay readable). One active share
  // per recipient and request: the owner changes its level instead (409). Never to oneself (422).
  // Under the dossier's lock, like its archiving, so neither interleaves with the other.
  async create(params: {
    dossierId: string
    user: { id: string; email: string }
    recipientEmail: string
    accessLevel: AccessLevel
  }): Promise<ShareLink & { shareUrl: string }> {
    const held = await this.dossiers.getForDiffusion(params.dossierId, params.user.id)
    const recipientEmail = params.recipientEmail.trim().toLowerCase()
    if (sameEmail(recipientEmail, params.user.email)) {
      throw new UnprocessableEntityException({
        code: 'SHARE_TO_SELF',
        message: 'Vous avez déjà accès à cette demande : invitez une autre adresse.',
      })
    }
    const { dossier, link, recipient, createdNewUser } = await this.prisma.$transaction(
      async (tx) => {
        const dossier = await lockDossier(tx, held.id, params.user.id)
        if (isArchived(dossier)) throw requestArchived()
        const active = await tx.shareLink.findMany({
          where: { dossierId: dossier.id, status: { in: ['active', 'pending'] } },
        })
        const existing = active.find((l) => sameEmail(l.recipientEmail, recipientEmail))
        if (existing) {
          throw new ConflictException({
            code: 'SHARE_ALREADY_ACTIVE',
            message:
              'Cette adresse a déjà un accès à cette demande : changez son niveau dans la liste des accès.',
            details: { shareLinkId: existing.id },
          })
        }
        const known = await tx.user.findUnique({ where: { email: recipientEmail } })
        const recipient =
          known ??
          (await tx.user.create({
            data: {
              email: recipientEmail,
              role: 'financeur',
              isActive: true,
              emailVerifiedAt: null,
            },
          }))
        const link = await tx.shareLink.create({
          data: {
            dossierId: dossier.id,
            recipientEmail,
            token: randomUUID(),
            status: 'active',
            accessLevel: params.accessLevel,
          },
        })
        return { dossier, link, recipient, createdNewUser: known === null }
      },
    )
    const shareUrl = `${this.config.get('FRONTEND_URL', { infer: true })}/share/${link.token}`
    await this.audit.record({
      actionType: 'share_link_created',
      shareLinkId: link.id,
      dossierId: dossier.id,
      actorId: params.user.id,
      metadata: {
        recipientEmail,
        recipientUserId: recipient.id,
        createdNewUser,
        accessLevel: params.accessLevel,
      },
    })
    try {
      await this.email.sendShareInvite({
        to: recipientEmail,
        dossierName: dossier.name,
        shareUrl,
        locale: (recipient.locale as 'fr') ?? 'fr',
      })
    } catch {
      // best-effort — audit already recorded
    }
    return { ...link, shareUrl }
  }

  // The list of accesses of a request, for its owner.
  async listForOwner(dossierId: string, userId: string): Promise<ShareAccess[]> {
    await this.dossiers.getByIdForUser(dossierId, userId)
    return this.accessList(dossierId)
  }

  // The same list for an administrator, on any request.
  async listForAdmin(dossierId: string): Promise<ShareAccess[]> {
    await this.findDossier(dossierId)
    return this.accessList(dossierId)
  }

  // Every share of the request, the latest first, each revoked one with who revoked it (from the
  // journal: `share_link_revoked` by the owner, `admin_revoked_share_link` by an administrator).
  private async accessList(dossierId: string): Promise<ShareAccess[]> {
    const links = await this.prisma.shareLink.findMany({
      where: { dossierId },
      orderBy: { createdAt: 'desc' },
    })
    const revoked = links.filter((l) => l.status === 'revoked').map((l) => l.id)
    const entries =
      revoked.length === 0
        ? []
        : await this.prisma.auditLog.findMany({
            where: {
              shareLinkId: { in: revoked },
              actionType: { in: Object.keys(REVOCATION_ACTIONS) as never },
            },
            select: { shareLinkId: true, actionType: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          })
    // The first revocation recorded: a later one could only be a former duplicate.
    const revokedBy = new Map<string, ShareRevokedBy>()
    for (const e of entries) {
      if (e.shareLinkId && !revokedBy.has(e.shareLinkId)) {
        revokedBy.set(
          e.shareLinkId,
          REVOCATION_ACTIONS[e.actionType as keyof typeof REVOCATION_ACTIONS],
        )
      }
    }
    return links.map((l) => ({ ...l, revokedBy: revokedBy.get(l.id) ?? null }))
  }

  // E07.01: the owner changes the level of an active share; its recipient keeps the same link and
  // reads the new level at their next request. Raising it diffuses more: refused on an archived
  // request (409), like a new share; lowering it is always possible. Under the dossier's lock; the
  // level read is the one replaced (a change or a revocation meanwhile: 409, nothing overwritten).
  // Journaled with the levels before and after; asking for the current level changes nothing.
  async changeLevel(params: {
    dossierId: string
    linkId: string
    userId: string
    accessLevel: AccessLevel
  }): Promise<ShareAccess> {
    const held = await this.dossiers.getByIdForUser(params.dossierId, params.userId)
    const changed = await this.prisma.$transaction(async (tx) => {
      const dossier = await lockDossier(tx, held.id, params.userId)
      const link = await this.findLink(tx, dossier.id, params.linkId)
      if (link.status !== 'active') {
        throw new ConflictException({
          code: 'SHARE_LINK_NOT_ACTIVE',
          message: 'Cet accès est révoqué : invitez à nouveau ce destinataire si besoin.',
        })
      }
      const from = grantedLevel(link.accessLevel)
      if (from === params.accessLevel) return null
      if (grantsAccess(params.accessLevel, from) && isArchived(dossier)) throw requestArchived()
      const { count } = await tx.shareLink.updateMany({
        where: { id: link.id, status: 'active', accessLevel: link.accessLevel },
        data: { accessLevel: params.accessLevel },
      })
      if (count === 0) throw shareChangedMeanwhile()
      return { link, from }
    })
    if (changed) {
      await this.audit.record({
        actionType: 'share_link_level_changed',
        shareLinkId: changed.link.id,
        dossierId: held.id,
        actorId: params.userId,
        metadata: {
          recipientEmail: changed.link.recipientEmail,
          from: changed.from,
          to: params.accessLevel,
        },
      })
    }
    return this.accessEntry(held.id, params.linkId)
  }

  // The owner revokes a share of their request.
  async revokeAsOwner(dossierId: string, linkId: string, userId: string): Promise<ShareAccess> {
    const held = await this.dossiers.getByIdForUser(dossierId, userId)
    return this.revoke(held.id, linkId, { id: userId, as: 'owner' })
  }

  // An administrator revokes a share of any request.
  async revokeAsAdmin(dossierId: string, linkId: string, adminId: string): Promise<ShareAccess> {
    await this.findDossier(dossierId)
    return this.revoke(dossierId, linkId, { id: adminId, as: 'admin' })
  }

  // Effective at the recipient's next request (the share guard reads the status each time). A share
  // already revoked stays as it was, without a second journal entry: two revocations at the same
  // moment journal one (the update only applies to a share not yet revoked).
  private async revoke(dossierId: string, linkId: string, actor: ShareActor) {
    const link = await this.findLink(this.prisma, dossierId, linkId)
    const revokedAt = new Date()
    const { count } = await this.prisma.shareLink.updateMany({
      where: { id: link.id, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt },
    })
    if (count > 0) {
      await this.audit.record({
        actionType: actor.as === 'admin' ? 'admin_revoked_share_link' : 'share_link_revoked',
        actorId: actor.id,
        dossierId,
        shareLinkId: link.id,
        metadata: {
          recipientEmail: link.recipientEmail,
          accessLevel: grantedLevel(link.accessLevel),
          revokedAt: revokedAt.toISOString(),
        },
      })
    }
    return this.accessEntry(dossierId, link.id)
  }

  private async accessEntry(dossierId: string, linkId: string): Promise<ShareAccess> {
    const entry = (await this.accessList(dossierId)).find((l) => l.id === linkId)
    if (!entry) throw linkNotFound()
    return entry
  }

  private async findLink(
    db: Prisma.TransactionClient | PrismaService,
    dossierId: string,
    linkId: string,
  ): Promise<ShareLink> {
    const link = await db.shareLink.findUnique({ where: { id: linkId } })
    if (!link || link.dossierId !== dossierId) throw linkNotFound()
    return link
  }

  private async findDossier(id: string): Promise<Dossier> {
    const dossier = await this.prisma.dossier.findUnique({ where: { id } })
    if (!dossier) throw dossierNotFound()
    return dossier
  }
}

const shareChangedMeanwhile = () =>
  new ConflictException({
    code: 'SHARE_LINK_CHANGED',
    message: 'Cet accès vient d’être modifié ou révoqué : rechargez la liste des accès.',
  })

function withoutFile(document: DocumentGroup): DocumentGroup {
  return {
    ...document,
    current: { ...document.current, url: null },
    versions: document.versions.map((v) => ({ ...v, url: null })),
  }
}
