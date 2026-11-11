import { randomUUID } from 'node:crypto'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import type { ShareLink } from '@prisma/client'
import type { AppConfig } from '../../config/config.schema'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EMAIL_TRANSPORT, type EmailTransport } from '../auth/email/email-transport'
import { Inject } from '@nestjs/common'
import type { AccessLevel } from '@confluent/shared'
import type { QuestionnaireField, QuestionnaireSection } from '@prisma/client'
import { AuthService } from '../auth/auth.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { DocumentsService, type DocumentGroup } from '../documents/documents.service'
import { fieldVisibleAt, grantedLevel, presentationForShare } from '../dossiers/financeur-access'

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface FinanceurShareResponse {
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
    // E05.07: the request's presentation, empty while it is a draft.
    summary: string | null
    objective: string | null
    description: string | null
    amountEur: number | null
    financingTypes: string[]
    publicationStatus: string
    publishedAt: Date | null
  }
  share: { recipientEmail: string; status: string; accessLevel: AccessLevel }
  // Already filtered by `share.accessLevel`: hidden fields and their answers never leave the server.
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
  answers: Array<{ fieldId: string; value: string }>
  // Only the documents the dossier selects, at the version selected (E05.07), that the level may
  // read: an attachment follows its field's level, any other document requires `complet` (E03.11).
  documents: DocumentGroup[]
}

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

  // A share opens a dossier, which presents its company's profile (E05.05): the answers its level
  // may read, the documents the dossier selects (E05.07) and, once published, its presentation.
  async resolveForFinanceur(shareLink: ShareLink): Promise<FinanceurShareResponse> {
    const dossier = await this.prisma.dossier.findUnique({ where: { id: shareLink.dossierId } })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    const [structure, answers] = await Promise.all([
      this.questionnaires.getVersion(dossier.questionnaireVersionId),
      this.prisma.dossierAnswer.findMany({
        where: { companyId: dossier.companyId },
        select: { fieldId: true, value: true },
      }),
    ])
    // The level of this very link — not the highest across the recipient's links: the token is what
    // was shared, and it may have been forwarded.
    const accessLevel = grantedLevel(shareLink.accessLevel)
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
      share: { recipientEmail: shareLink.recipientEmail, status: shareLink.status, accessLevel },
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

  async create(params: {
    dossierId: string
    userId: string
    recipientEmail: string
    accessLevel?: string
  }): Promise<ShareLink & { shareUrl: string }> {
    // A company a conseiller prepares for an entrepreneur is shared by that entrepreneur only, once
    // its owner (E05.08): 409 for its holder.
    const dossier = await this.dossiers.getForDiffusion(params.dossierId, params.userId)
    const recipientEmail = params.recipientEmail.trim().toLowerCase()

    const existingRecipient = await this.prisma.user.findUnique({
      where: { email: recipientEmail },
    })
    const recipient =
      existingRecipient ??
      (await this.prisma.user.create({
        data: {
          email: recipientEmail,
          role: 'financeur',
          isActive: true,
          emailVerifiedAt: null,
        },
      }))
    const createdNewUser = existingRecipient === null

    const token = randomUUID()
    const link = await this.prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail,
        token,
        status: 'active',
        accessLevel: params.accessLevel ?? 'complet',
      },
    })
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true })
    const shareUrl = `${frontendUrl}/share/${token}`
    await this.audit.record({
      actionType: 'share_link_created',
      shareLinkId: link.id,
      dossierId: dossier.id,
      actorId: params.userId,
      metadata: {
        recipientEmail,
        recipientUserId: recipient.id,
        createdNewUser,
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

  listForDossier(dossierId: string, userId: string): Promise<ShareLink[]> {
    return this.dossiers.getByIdForUser(dossierId, userId).then(() =>
      this.prisma.shareLink.findMany({
        where: { dossierId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async revoke(dossierId: string, linkId: string, userId: string): Promise<ShareLink> {
    await this.dossiers.getByIdForUser(dossierId, userId)
    const existing = await this.prisma.shareLink.findUnique({ where: { id: linkId } })
    if (!existing || existing.dossierId !== dossierId) {
      throw new NotFoundException({
        code: 'SHARE_LINK_NOT_FOUND',
        message: 'Share link not found.',
      })
    }
    const updated = await this.prisma.shareLink.update({
      where: { id: linkId },
      data: { status: 'revoked', revokedAt: new Date() },
    })
    await this.audit.record({
      actionType: 'share_link_revoked',
      shareLinkId: linkId,
      dossierId,
      actorId: userId,
    })
    return updated
  }
}
