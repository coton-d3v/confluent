import { Injectable } from '@nestjs/common'
import {
  SHOWCASE_CARD_LIMITS,
  pseudonymRevealsName,
  showcaseCardBlocker,
  showcaseCardState,
  showcaseCommitteeOf,
  type PublicCard,
  type ShowcaseCardBlocker,
  type ShowcaseRegion,
} from '@confluent/shared'
import type { Candidature, Dossier, ShowcaseCard, Workspace } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SITE_ORIGIN, originMetadata } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import { DossiersService, lockDossier } from '../dossiers/dossiers.service'
import { poolPublicationBlocked } from '../pool-publications/pool-publication'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { ShowcaseCardErrors } from './showcase-card-errors'
import { toPublicCard } from './showcase-card-views'
import {
  showcaseCardView,
  showcaseRealNamesOf,
  showcaseWithdrawalEntry,
  type ManagedShowcaseCardView,
  type ShowcaseCardView,
} from './showcase-cards'

// The consent as validated by @confluent/shared `setShowcaseCardSchema`.
export interface ShowcaseCardInput {
  pseudonym: string
  region: ShowcaseRegion | null
  consent: true
  version: number | null
}

// @confluent/shared `ownerShowcaseCardSchema`.
export interface OwnerShowcaseCardView {
  workspace: { name: string; slug: string }
  pagePublished: boolean
  card: ShowcaseCardView | null
  version: number | null
  blocker: ShowcaseCardBlocker | null
  preview: Omit<PublicCard, 'pseudonym'> & { pseudonym: string | null }
}

// @confluent/shared `receivedShowcaseCardSchema`.
export interface ReceivedShowcaseCardView {
  pagePublished: boolean
  card: ShowcaseCardView | null
}

// One card to build: its consent (or none, for the owner's preview), the candidature and the request.
interface CardItem {
  card: Pick<ShowcaseCard, 'pseudonym' | 'region'>
  candidature: Candidature
  dossier: Dossier
}

// ROADMAP E09.02: the anonymous cards of financing requests on a workspace's public page — rules in
// @confluent/shared `showcase-card.schema.ts`.
//
// Only the owner of the request consents and withdraws, through the owner access to its candidature
// (`CandidaturesService.findOwned`: `404` for anyone else — the workspace's conseillers and
// Confluent's administrators included); a company prepared by a conseiller is shown by nobody (`409`,
// E05.08). Each change holds the request's lock, then the candidature's — the order of the archiving,
// which withdraws every card of the request — is made from the version the owner read (`409`
// otherwise, never reused: R63) and journaled in the same transaction. The workspace's conseillers
// (`findReceived`) read where a received candidature's card stands, never change it. The public reads
// the cards through `publicCards` only, built by `toPublicCard` from the request as the narrowest
// share level reads it.
//
// E09.03: a stored pseudonym is checked again at each read (`showcasePseudonymUsable`, against the
// real names as they are now), and the workspace's managers (`canManageWorkspace`) list the cards of
// their page and hide or restore one — never change it — under the workspace's lock (FOR SHARE: a
// change of their right waits), then the request's and the candidature's, in the owner's order, the
// right read again after them (R53), with a new version (R63) and a journal entry.
@Injectable()
export class ShowcaseCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly dossiers: DossiersService,
    private readonly audit: AuditService,
    private readonly access: WorkspaceAccessService,
  ) {}

  // ── The owner ────────────────────────────────────────────────────────────────────────────────

  async forOwner(candidatureId: string, userId: string): Promise<OwnerShowcaseCardView> {
    const { candidature, dossier } = await this.candidatures.findOwned(candidatureId, userId)
    const [workspace, row, names] = await Promise.all([
      this.workspaceOf(candidature.workspaceId),
      this.prisma.showcaseCard.findUnique({ where: { candidatureId: candidature.id } }),
      showcaseRealNamesOf(this.prisma, [dossier]),
    ])
    const [preview] = await this.build(
      [
        {
          card: { pseudonym: row?.pseudonym ?? '', region: row?.region ?? null },
          candidature,
          dossier,
        },
      ],
      Date.now(),
    )
    return {
      workspace: { name: workspace.name, slug: workspace.slug },
      pagePublished: workspace.publicPagePublished,
      card: showcaseCardView(row, dossier, candidature, workspace, names.get(dossier.id)!),
      version: row?.version ?? null,
      blocker: showcaseCardBlocker(dossier, candidature),
      preview: { ...preview, pseudonym: row?.pseudonym ?? null },
    }
  }

  // The owner's explicit consent: shows the card under the pseudonym (and region) they chose, again
  // after a withdrawal, or changes them. Needs the candidature sent, the request published and its
  // financing status open there (`409` otherwise, as for the pool). The same pseudonym and region on
  // an active card change nothing. A pseudonym equal to the company's name, the request's title or
  // the owner's name is refused (`400`).
  async publish(
    candidatureId: string,
    userId: string,
    input: ShowcaseCardInput,
  ): Promise<OwnerShowcaseCardView> {
    const { candidature } = await this.candidatures.findOwned(candidatureId, userId)
    await this.dossiers.getForDiffusion(candidature.dossierId, userId)
    await this.prisma.$transaction(async (tx) => {
      const request = await lockDossier(tx, candidature.dossierId, userId)
      const current = await this.candidatures.lockAs(tx, { side: 'owner', userId }, candidature.id)
      const existing = await tx.showcaseCard.findUnique({ where: { candidatureId: current.id } })
      if ((existing?.version ?? null) !== input.version) {
        throw ShowcaseCardErrors.changed(existing?.version ?? null)
      }
      // E09.03: before the same values are kept as they are — a real name may have become equal to
      // the pseudonym since it was given.
      const names = (await showcaseRealNamesOf(tx, [request])).get(request.id)!
      if (pseudonymRevealsName(input.pseudonym, names)) {
        throw ShowcaseCardErrors.revealsName()
      }
      const active = existing !== null && existing.withdrawnAt === null
      if (active && existing.pseudonym === input.pseudonym && existing.region === input.region) {
        return
      }
      const blocker = showcaseCardBlocker(request, current)
      if (blocker) throw poolPublicationBlocked(blocker)
      const consent = {
        pseudonym: input.pseudonym,
        region: input.region,
        consentedAt: new Date(),
        consentedById: userId,
        withdrawnAt: null,
        withdrawnById: null,
        withdrawalReason: null,
      }
      const row = existing
        ? await tx.showcaseCard.update({
            where: { id: existing.id },
            data: { ...consent, version: existing.version + 1 },
          })
        : await tx.showcaseCard.create({
            data: { candidatureId: current.id, workspaceId: current.workspaceId, ...consent },
          })
      await this.audit.recordIn(tx, {
        actionType: 'showcase_card_published',
        actorId: userId,
        dossierId: request.id,
        metadata: {
          // No MCP tool consents to a card (E09.07): the site.
          ...originMetadata(SITE_ORIGIN),
          candidatureId: current.id,
          workspaceId: current.workspaceId,
          version: row.version,
          // What was consented to: the pseudonym and region shown to anyone.
          pseudonym: row.pseudonym,
          region: row.region,
          republished: existing !== null && !active,
        },
      })
    })
    return this.forOwner(candidatureId, userId)
  }

  // The owner withdraws the card from this workspace's page, gone at the next public read.
  // Withdrawing a card already withdrawn, or never consented, changes nothing.
  async withdraw(candidatureId: string, userId: string): Promise<OwnerShowcaseCardView> {
    const { candidature } = await this.candidatures.findOwned(candidatureId, userId)
    await this.prisma.$transaction(async (tx) => {
      await lockDossier(tx, candidature.dossierId, userId)
      const current = await this.candidatures.lockAs(tx, { side: 'owner', userId }, candidature.id)
      const active = await tx.showcaseCard.findFirst({
        where: { candidatureId: current.id, withdrawnAt: null },
      })
      if (!active) return
      const row = await tx.showcaseCard.update({
        where: { id: active.id },
        data: {
          withdrawnAt: new Date(),
          withdrawnById: userId,
          withdrawalReason: 'owner',
          version: active.version + 1,
        },
      })
      await this.audit.recordIn(
        tx,
        showcaseWithdrawalEntry(row, candidature.dossierId, userId, 'owner'),
      )
    })
    return this.forOwner(candidatureId, userId)
  }

  // ── The workspace ────────────────────────────────────────────────────────────────────────────

  // Where a received candidature's card stands, read-only, for the workspace's conseillers and
  // Confluent's administrators (`findReceived`: `403` investor, `404` outside the workspace or a
  // draft). Never its version: they change nothing.
  async forWorkspace(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
  ): Promise<ReceivedShowcaseCardView> {
    const candidature = await this.candidatures.findReceived(actor, workspaceId, candidatureId)
    const [workspace, dossier, row] = await Promise.all([
      this.workspaceOf(workspaceId),
      // A candidature goes with its request.
      this.prisma.dossier.findUnique({ where: { id: candidature.dossierId } }).then((d) => d!),
      this.prisma.showcaseCard.findUnique({ where: { candidatureId: candidature.id } }),
    ])
    const names = await showcaseRealNamesOf(this.prisma, [dossier])
    return {
      pagePublished: workspace.publicPagePublished,
      card: showcaseCardView(row, dossier, candidature, workspace, names.get(dossier.id)!),
    }
  }

  // E09.03: the cards of the workspace's page for its managers (`assertCanManage`: `404` outside it,
  // `403` for another member) — every consent not withdrawn, shown, paused or hidden, the latest
  // first —, to hide or restore them.
  async listForManagers(
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<ManagedShowcaseCardView[]> {
    const { workspace } = await this.access.assertCanManage(actor, workspaceId)
    const rows = await this.prisma.showcaseCard.findMany({
      where: { workspaceId, withdrawnAt: null },
      orderBy: [{ consentedAt: 'desc' }, { id: 'asc' }],
    })
    return this.managed(workspace, rows)
  }

  // E09.03: a manager hides the card of a candidature from the workspace's page (`hidden: true`) or
  // restores it (`false`): a card not withdrawn, of this workspace (`404` otherwise, as for an unknown
  // candidature). The same state again writes nothing. The owner reads it hidden and may still
  // withdraw it; nothing of the card itself changes.
  async setHidden(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    hidden: boolean,
  ): Promise<ManagedShowcaseCardView> {
    await this.access.assertCanManage(actor, workspaceId)
    const candidature = await this.prisma.candidature.findFirst({
      where: { id: candidatureId, workspaceId },
    })
    if (!candidature) throw ShowcaseCardErrors.notFound()
    const row = await this.prisma.$transaction(async (tx) => {
      // The workspace first (FOR SHARE: a change of the managers' rights waits, two moderations do
      // not), then the request and the candidature, in the order of the owner's consent and of the
      // archiving; the right is read after them (R53).
      await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR SHARE`
      await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${candidature.dossierId} FOR UPDATE`
      await tx.$queryRaw`SELECT 1 FROM "candidatures" WHERE "id" = ${candidature.id} FOR UPDATE`
      await this.access.assertCanManage(actor, workspaceId, tx)
      const card = await tx.showcaseCard.findFirst({
        where: { candidatureId: candidature.id, workspaceId, withdrawnAt: null },
      })
      if (!card) throw ShowcaseCardErrors.notFound()
      if ((card.hiddenAt !== null) === hidden) return card
      const updated = await tx.showcaseCard.update({
        where: { id: card.id },
        data: {
          hiddenAt: hidden ? new Date() : null,
          hiddenById: hidden ? actor.id : null,
          version: card.version + 1,
        },
      })
      await this.audit.recordIn(tx, {
        actionType: hidden ? 'showcase_card_hidden' : 'showcase_card_unhidden',
        actorId: actor.id,
        dossierId: candidature.dossierId,
        metadata: {
          // No MCP tool moderates a card (E09.07): the site.
          ...originMetadata(SITE_ORIGIN),
          candidatureId: candidature.id,
          workspaceId,
          version: updated.version,
        },
      })
      return updated
    })
    const [view] = await this.managed(await this.workspaceOf(workspaceId), [row])
    return view
  }

  // ── The public ───────────────────────────────────────────────────────────────────────────────

  // THE cards of a workspace's page, the latest consents first, at most
  // `SHOWCASE_CARD_LIMITS.cardsPerPage`: every consent not withdrawn whose candidature and request
  // meet the rule (`showcaseCardState`). Whether the page itself is published is the caller's gate
  // (E09.01: `404` otherwise) — its managers' preview shows the cards it would show once published.
  async publicCards(workspace: Workspace, now: number): Promise<PublicCard[]> {
    const rows = await this.prisma.showcaseCard.findMany({
      where: { workspaceId: workspace.id, withdrawnAt: null },
      orderBy: [{ consentedAt: 'desc' }, { id: 'asc' }],
    })
    if (rows.length === 0) return []
    const candidatures = await this.prisma.candidature.findMany({
      where: { id: { in: rows.map((r) => r.candidatureId) }, workspaceId: workspace.id },
    })
    const dossiers = await this.prisma.dossier.findMany({
      where: { id: { in: [...new Set(candidatures.map((c) => c.dossierId))] } },
    })
    const candidatureById = new Map(candidatures.map((c) => [c.id, c]))
    const dossierById = new Map(dossiers.map((d) => [d.id, d]))
    const names = await showcaseRealNamesOf(this.prisma, dossiers)
    const page = { publicPagePublished: true }
    const items = rows.flatMap((card): CardItem[] => {
      const candidature = candidatureById.get(card.candidatureId)
      const dossier = candidature && dossierById.get(candidature.dossierId)
      if (!candidature || !dossier) return []
      return showcaseCardState(card, dossier, candidature, page, names.get(dossier.id) ?? [])
        .state === 'shown'
        ? [{ card, candidature, dossier }]
        : []
    })
    return this.build(items.slice(0, SHOWCASE_CARD_LIMITS.cardsPerPage), now)
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  // The cards of these candidatures by `toPublicCard`: the request as the narrowest share level reads
  // it (its sector), the plan's lines of each candidature, the session that retained it.
  private async build(items: CardItem[], now: number): Promise<PublicCard[]> {
    if (items.length === 0) return []
    const candidatureIds = items.map((i) => i.candidature.id)
    const [projected, lines, entries] = await Promise.all([
      this.dossiers.projectEachForLevel(
        items.map((i) => ({ dossier: i.dossier, level: 'public' })),
      ),
      this.prisma.fundingPlanLine.findMany({ where: { candidatureId: { in: candidatureIds } } }),
      this.prisma.committeeApplication.findMany({
        where: { candidatureId: { in: candidatureIds }, status: 'accepted' },
      }),
    ])
    const committees = entries.length
      ? await this.prisma.committee.findMany({
          where: { id: { in: [...new Set(entries.map((e) => e.committeeId))] } },
        })
      : []
    const committeeById = new Map(committees.map((c) => [c.id, c]))
    return items.map((item, i) => {
      const own = (row: { candidatureId: string; workspaceId: string }) =>
        row.candidatureId === item.candidature.id &&
        row.workspaceId === item.candidature.workspaceId
      const sessions = entries.filter(own).flatMap((e) => {
        const committee = committeeById.get(e.committeeId)
        return committee && committee.workspaceId === item.candidature.workspaceId
          ? [{ status: e.status, committee }]
          : []
      })
      return toPublicCard({
        card: item.card,
        dossier: projected[i],
        lines: lines.filter(own),
        committee: showcaseCommitteeOf(sessions, now),
      })
    })
  }

  // A candidature's workspace (restricted on deletion while it has candidatures).
  private async workspaceOf(id: string): Promise<Workspace> {
    return (await this.prisma.workspace.findUnique({ where: { id } }))!
  }

  // The managers' view of these cards of a workspace, by THE rule of the cards.
  private async managed(
    workspace: Workspace,
    rows: ShowcaseCard[],
  ): Promise<ManagedShowcaseCardView[]> {
    if (rows.length === 0) return []
    const candidatures = await this.prisma.candidature.findMany({
      where: { id: { in: rows.map((r) => r.candidatureId) }, workspaceId: workspace.id },
    })
    const dossiers = await this.prisma.dossier.findMany({
      where: { id: { in: [...new Set(candidatures.map((c) => c.dossierId))] } },
    })
    const names = await showcaseRealNamesOf(this.prisma, dossiers)
    const candidatureById = new Map(candidatures.map((c) => [c.id, c]))
    const dossierById = new Map(dossiers.map((d) => [d.id, d]))
    return rows.flatMap((row) => {
      const candidature = candidatureById.get(row.candidatureId)
      const dossier = candidature && dossierById.get(candidature.dossierId)
      const card =
        candidature &&
        dossier &&
        showcaseCardView(row, dossier, candidature, workspace, names.get(dossier.id)!)
      if (!card) return []
      return [
        {
          candidatureId: row.candidatureId,
          pseudonym: card.pseudonym,
          region: card.region,
          state: card.state,
          pausedBecause: card.pausedBecause,
          consentedAt: card.consentedAt,
          hiddenAt: row.hiddenAt,
        },
      ]
    })
  }
}
