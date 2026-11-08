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
import { grantsAccess, type AccessLevel } from '@confluent/shared'
import type { QuestionnaireField } from '@prisma/client'
import { AuthService } from '../auth/auth.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { DocumentsService, type DocumentGroup } from '../documents/documents.service'
import {
  DOCUMENTS_MIN_LEVEL,
  fieldVisibleAt,
  grantedLevel,
  projectDossierForLevel,
} from '../dossiers/financeur-access'

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
  }
  share: { recipientEmail: string; status: string; accessLevel: AccessLevel }
  // Already filtered by `share.accessLevel`: hidden fields and their answers never leave the server.
  fields: QuestionnaireField[]
  answers: Array<{ fieldId: string; value: string }>
  // null when the level does not grant documents (below `complet`).
  documents: DocumentGroup[] | null
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
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  // E02.08: a share link opens the dossier only to the account it was sent to. A forwarded link
  // used by someone else — even logged in — gets nothing.
  assertRecipient(shareLink: ShareLink, user: { email: string } | undefined): void {
    if (user && !sameEmail(user.email, shareLink.recipientEmail)) {
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

  async resolveForFinanceur(shareLink: ShareLink): Promise<FinanceurShareResponse> {
    const dossier = await this.prisma.dossier.findUnique({
      where: { id: shareLink.dossierId },
      include: {
        questionnaireVersion: {
          include: { fields: { orderBy: [{ section: 'asc' }, { orderIndex: 'asc' }] } },
        },
        answers: { select: { fieldId: true, value: true } },
      },
    })
    if (!dossier) {
      throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier not found.' })
    }
    // The level of this very link — not the highest across the recipient's links: the token is what
    // was shared, and it may have been forwarded.
    const accessLevel = grantedLevel(shareLink.accessLevel)
    const { questionnaireVersion, answers, ...row } = projectDossierForLevel(dossier, accessLevel)
    const fields = questionnaireVersion.fields.filter((f) => fieldVisibleAt(f, accessLevel))
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
      },
      share: { recipientEmail: shareLink.recipientEmail, status: shareLink.status, accessLevel },
      fields,
      answers: answers.filter((a) => visibleIds.has(a.fieldId)),
      documents: grantsAccess(accessLevel, DOCUMENTS_MIN_LEVEL)
        ? await this.documents.listForDossier(dossier.id)
        : null,
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
    const dossier = await this.dossiers.getByIdForUser(params.dossierId, params.userId)
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
