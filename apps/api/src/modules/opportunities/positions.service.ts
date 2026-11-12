import { ConflictException, Injectable } from '@nestjs/common'
import {
  isArchived,
  pledgeIntentionOf,
  type AccessLevel,
  type PledgeIntention,
} from '@confluent/shared'
import type { InvestorInterest, InvestorPledge, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { originMetadata, type ActionOrigin } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { listedPoolPublications } from '../pool-publications/pool-publication'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import {
  OpportunitiesService,
  interestIdentity,
  interestView,
  lockRequest,
  opportunityNotFound,
  pledgeView,
  type InterestIdentityView,
  type CurrentReader,
  type ListedDossier,
  type OpportunityInterestView,
  type OpportunityPledgeView,
  type OpportunityReader,
} from './opportunities.service'

interface WorkspaceRef {
  id: string
  name: string
}

// @confluent/shared `positionDisclosureSchema`.
export interface PositionDisclosureView {
  id: string
  workspace: WorkspaceRef
  disclosedAt: Date
}

// @confluent/shared `myPositionsSchema`.
export interface MyPositionsView {
  items: Array<{
    dossierId: string
    readable: boolean
    closed: boolean
    dossier: ListedDossier | null
    accessLevel: AccessLevel | null
    interest: OpportunityInterestView | null
    pledge: OpportunityPledgeView | null
    disclosures: PositionDisclosureView[]
  }>
}

// @confluent/shared `dossierPositionsSchema`.
export interface DossierPositionsView {
  interests: { count: number }
  pledges: { count: number; totalEur: number }
  named: Array<{
    identity: InterestIdentityView
    interest: { markedAt: Date } | null
    pledge: { amountEur: number | null } | null
  }>
  anonymousAmounts: number[]
}

// @confluent/shared `workspacePositionsSchema`.
export interface WorkspacePositionsView {
  items: Array<{
    candidatureId: string
    dossier: { id: string; name: string }
    company: { name: string }
    investors: Array<{
      identity: InterestIdentityView
      disclosedAt: Date
      interest: { markedAt: Date } | null
      pledge: { intention: PledgeIntention; amountEur: number; updatedAt: Date } | null
    }>
    pledgedEur: number
  }>
}

const notFromStructure = () =>
  new ConflictException({
    code: 'POSITION_NOT_FROM_STRUCTURE',
    message:
      'Cette demande ne vous parvient pas par le vivier de cette structure : vous ne pouvez pas lui montrer votre positionnement.',
  })

const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

// Who reads the pledges on a request for a financing plan (E06.04): its owner, or one structure.
export type PledgeAudience = { side: 'owner' } | { side: 'workspace'; workspaceId: string }

// A pledge as one audience reads it: the identity it is shown with, and whether the audience knows
// it one by one — the structure always (the investor's consent shows it name and amount), the owner
// only when the investor shows both their name and their amount.
export interface AudiencePledge {
  pledge: InvestorPledge
  identity: InterestIdentityView
  individual: boolean
}

// One investor's marks and pledges on a request, as the owner may read them (E07.05, E07.06).
export interface OwnerSideInput {
  identity: InterestIdentityView
  interest: Pick<InvestorInterest, 'nameVisible' | 'createdAt'> | null
  pledge: Pick<InvestorPledge, 'showName' | 'showAmount' | 'amountEur'> | null
}

// What the owner reads of the positions of the investors who read the request now — the rule of
// `dossierPositionsSchema`, in one place: everything counted; a line by name only for what shows the
// name; a mark and a pledge on one line only when both show it; a pledge that hides the name, its
// amount alone when shown. Never an intention, a comment or an address.
export function ownerPositions(investors: OwnerSideInput[]): DossierPositionsView {
  const view: DossierPositionsView = {
    interests: { count: 0 },
    pledges: { count: 0, totalEur: 0 },
    named: [],
    anonymousAmounts: [],
  }
  for (const { identity, interest, pledge } of investors) {
    if (interest) view.interests.count += 1
    if (pledge) {
      view.pledges.count += 1
      view.pledges.totalEur += pledge.amountEur
      if (!pledge.showName && pledge.showAmount) view.anonymousAmounts.push(pledge.amountEur)
    }
    const namedInterest = interest?.nameVisible ? { markedAt: interest.createdAt } : null
    const namedPledge = pledge?.showName
      ? { amountEur: pledge.showAmount ? pledge.amountEur : null }
      : null
    if (namedInterest || namedPledge) {
      view.named.push({ identity, interest: namedInterest, pledge: namedPledge })
    }
  }
  view.named.sort((a, b) => byName.compare(a.identity.name ?? '', b.identity.name ?? ''))
  view.anonymousAmounts.sort((a, b) => b - a)
  return view
}

// How a structure names an investor: their name and their organization in that structure only.
function structureIdentity(reader: CurrentReader, workspaceId: string): InterestIdentityView {
  const organization = reader.reached.organizationIn.get(workspaceId)
  return interestIdentity(reader.investor, organization ? [organization] : [])
}

// ROADMAP E07.07 — investors' positions (marks of interest, E07.05, and pledges, E07.06) as each
// audience reads them (rules in @confluent/shared `position.schema.ts`): the investor their own,
// the owner what E07.05/E07.06 open to them in one view, a structure only what an investor
// explicitly consented to show it. Who reads a request as an opportunity is THE rule of E07.03
// (`OpportunitiesService.reachOne`/`readersNow`), read at each request; nothing here duplicates it.
@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
    private readonly dossiers: DossiersService,
    private readonly candidatures: CandidaturesService,
    private readonly audit: AuditService,
  ) {}

  // « Mes positionnements »: the reader's own marks, pledges and consents, from their account only;
  // of a request they no longer read, nothing but its closure.
  async mine(reader: OpportunityReader): Promise<MyPositionsView> {
    const own = { investorId: reader.id }
    const [interests, pledges, disclosures] = await Promise.all([
      this.prisma.investorInterest.findMany({ where: own }),
      this.prisma.investorPledge.findMany({ where: own }),
      this.prisma.investorPositionDisclosure.findMany({ where: own }),
    ])
    const mine = <T extends { investorId: string }>(rows: T[]) =>
      rows.filter((r) => r.investorId === reader.id)
    const ids = [
      ...new Set(
        [...mine(interests), ...mine(pledges), ...mine(disclosures)].map((r) => r.dossierId),
      ),
    ]
    if (ids.length === 0) return { items: [] }
    const [readable, requests, workspaces] = await Promise.all([
      this.opportunities.readable(reader, ids),
      this.prisma.dossier.findMany({
        where: { id: { in: ids } },
        select: { id: true, publicationStatus: true },
      }),
      this.prisma.workspace.findMany({
        where: { id: { in: [...new Set(disclosures.map((d) => d.workspaceId))] } },
        select: { id: true, name: true },
      }),
    ])
    const statusOf = new Map(requests.map((r) => [r.id, r] as const))
    const workspaceOf = new Map(workspaces.map((w) => [w.id, { id: w.id, name: w.name }] as const))

    const items = ids.map((dossierId) => {
      const interest = mine(interests).find((m) => m.dossierId === dossierId) ?? null
      const pledge = mine(pledges).find((p) => p.dossierId === dossierId) ?? null
      const consents = mine(disclosures).filter((d) => d.dossierId === dossierId)
      const read = readable.get(dossierId)
      const request = statusOf.get(dossierId)
      const latest = Math.max(
        interest?.updatedAt.getTime() ?? 0,
        pledge?.updatedAt.getTime() ?? 0,
        ...consents.map((d) => d.createdAt.getTime()),
      )
      return {
        latest,
        item: {
          dossierId,
          readable: read !== undefined,
          closed: request !== undefined && isArchived(request),
          dossier: read?.dossier ?? null,
          accessLevel: read?.access.accessLevel ?? null,
          interest: interest ? interestView(interest) : null,
          pledge: pledge ? pledgeView(pledge) : null,
          disclosures: consents
            .flatMap((d) => {
              const workspace = workspaceOf.get(d.workspaceId)
              return workspace ? [{ id: d.id, workspace, disclosedAt: d.createdAt }] : []
            })
            .sort((a, b) => byName.compare(a.workspace.name, b.workspace.name)),
        },
      }
    })
    items.sort((a, b) => b.latest - a.latest || a.item.dossierId.localeCompare(b.item.dossierId))
    return { items: items.map((i) => i.item) }
  }

  // The reader consents to show a structure their position on a request. Only on a request they
  // read now (the opportunity's `404`) through that structure's pool (`409` otherwise: another
  // structure, a direct share alone). Given again, nothing changes and nothing is journaled.
  // `origin` (E07.10): the application and the request it reported, when an assistant asked (MCP).
  async disclose(
    reader: OpportunityReader,
    dossierId: string,
    workspaceId: string,
    origin?: ActionOrigin,
  ): Promise<PositionDisclosureView> {
    return this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, dossierId)
      const found = await this.opportunities.reachOne(reader, dossierId, tx)
      if (!found) throw opportunityNotFound()
      const source = found.sources.find((s) => s.kind === 'pool' && s.workspace.id === workspaceId)
      if (!source || source.kind !== 'pool') throw notFromStructure()
      const key = {
        dossierId_investorId_workspaceId: { dossierId, investorId: reader.id, workspaceId },
      }
      const current = await tx.investorPositionDisclosure.findUnique({ where: key })
      if (current && current.investorId === reader.id) {
        return { id: current.id, workspace: source.workspace, disclosedAt: current.createdAt }
      }
      const created = await tx.investorPositionDisclosure.create({
        data: { dossierId, investorId: reader.id, workspaceId },
      })
      await this.audit.recordIn(tx, {
        actionType: 'investor_position_disclosed',
        actorId: reader.id,
        dossierId,
        metadata: {
          workspaceId,
          accessLevel: found.accessLevel,
          ...(origin ? originMetadata(origin) : {}),
        },
      })
      return { id: created.id, workspace: source.workspace, disclosedAt: created.createdAt }
    })
  }

  // Withdraws one of the reader's consents, by its id, whether they still read the request or are
  // still in the structure or not — a consent stays revocable at any time: the same `204` for their
  // own consent, one already withdrawn, another account's or an unknown one.
  async withdrawDisclosure(
    reader: OpportunityReader,
    disclosureId: string,
    origin?: ActionOrigin,
  ): Promise<void> {
    const found = await this.prisma.investorPositionDisclosure.findUnique({
      where: { id: disclosureId },
    })
    if (!found || found.investorId !== reader.id) return
    await this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, found.dossierId)
      const current = await tx.investorPositionDisclosure.findUnique({
        where: { id: disclosureId },
      })
      if (!current || current.investorId !== reader.id) return
      await tx.investorPositionDisclosure.delete({ where: { id: current.id } })
      await this.audit.recordIn(tx, {
        actionType: 'investor_position_disclosure_withdrawn',
        actorId: reader.id,
        dossierId: current.dossierId,
        metadata: {
          workspaceId: current.workspaceId,
          ...(origin ? originMetadata(origin) : {}),
        },
      })
    })
  }

  // What the owner reads: the marks and pledges of the investors who read the request now
  // (`readersNow`, E07.05/E07.06's rule), by `ownerPositions`. Anyone but the owner: the dossier's
  // `404`.
  async forOwner(dossierId: string, ownerId: string): Promise<DossierPositionsView> {
    await this.dossiers.getByIdForUser(dossierId, ownerId)
    const [marks, pledges] = await Promise.all([
      this.prisma.investorInterest.findMany({ where: { dossierId } }),
      this.prisma.investorPledge.findMany({ where: { dossierId } }),
    ])
    const ours = <T extends { dossierId: string }>(rows: T[]) =>
      rows.filter((r) => r.dossierId === dossierId)
    const readers = await this.opportunities.readersNow(dossierId, [
      ...ours(marks).map((m) => m.investorId),
      ...ours(pledges).map((p) => p.investorId),
    ])
    return ownerPositions(
      [...readers.values()].map(({ investor, reached }) => ({
        identity: interestIdentity(investor, reached.organizations),
        interest: ours(marks).find((m) => m.investorId === investor.id) ?? null,
        pledge: ours(pledges).find((p) => p.investorId === investor.id) ?? null,
      })),
    )
  }

  // The pledges on one request that an audience reads — THE rules of E07.06 (owner) and E07.07
  // (structure), the ones of `forOwner`/`forWorkspace` —, for a financing plan (E06.04): the owner,
  // every pledge of an investor who reads the request now; a structure, those of the investors who
  // consented to show it their position and read the request through its pool, nothing else. The
  // caller has checked the audience's access to the request. `db`: the caller's transaction.
  async pledgesFor(
    audience: PledgeAudience,
    dossierId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<AudiencePledge[]> {
    const pledges = (await db.investorPledge.findMany({ where: { dossierId } })).filter(
      (p) => p.dossierId === dossierId,
    )
    if (audience.side === 'owner') {
      const readers = await this.opportunities.readersNow(
        dossierId,
        pledges.map((p) => p.investorId),
        db,
      )
      return pledges.flatMap((pledge) => {
        const reader = readers.get(pledge.investorId)
        if (!reader) return []
        return [
          {
            pledge,
            identity: interestIdentity(reader.investor, reader.reached.organizations),
            individual: pledge.showName && pledge.showAmount,
          },
        ]
      })
    }
    const { workspaceId } = audience
    const consents = (
      await db.investorPositionDisclosure.findMany({ where: { workspaceId, dossierId } })
    ).filter((d) => d.workspaceId === workspaceId && d.dossierId === dossierId)
    const readers = await this.consentedReaders(
      workspaceId,
      dossierId,
      consents.map((d) => d.investorId),
      db,
    )
    return pledges.flatMap((pledge) => {
      const reader = readers.get(pledge.investorId)
      if (!reader) return []
      return [{ pledge, identity: structureIdentity(reader, workspaceId), individual: true }]
    })
  }

  // Of the investors who consented to show a structure their position on a request, those whose
  // consent counts now: they read the request through this very pool (E07.07).
  private async consentedReaders(
    workspaceId: string,
    dossierId: string,
    investorIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, CurrentReader>> {
    const readers = await this.opportunities.readersNow(dossierId, investorIds, db)
    for (const [id, reader] of readers) {
      if (!reader.reached.sources.some((s) => s.kind === 'pool' && s.workspace.id === workspaceId))
        readers.delete(id)
    }
    return readers
  }

  // What a structure reads (its conseillers and administrators — the candidatures' read rule,
  // `404`/`403`): each request listed in its pool now, with the positions of the investors who
  // consented to show it theirs and still read the request through that pool. Nothing of anyone
  // else, not even a count; never a pledge's comment.
  async forWorkspace(actor: WorkspaceActor, workspaceId: string): Promise<WorkspacePositionsView> {
    const received = await this.candidatures.receivedRows(actor, workspaceId)
    const listed = (await listedPoolPublications(this.prisma, [workspaceId])).filter((l) =>
      received.some((c) => c.id === l.candidature.id),
    )
    if (listed.length === 0) return { items: [] }
    const dossierIds = listed.map((l) => l.dossier.id)
    const [disclosures, companies] = await Promise.all([
      this.prisma.investorPositionDisclosure.findMany({
        where: { workspaceId, dossierId: { in: dossierIds } },
      }),
      this.prisma.company.findMany({
        where: { id: { in: listed.map((l) => l.dossier.companyId) } },
        select: { id: true, name: true },
      }),
    ])
    const consented = disclosures.filter(
      (d) => d.workspaceId === workspaceId && dossierIds.includes(d.dossierId),
    )
    const investorIds = [...new Set(consented.map((d) => d.investorId))]
    const [marks, pledges] =
      investorIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.investorInterest.findMany({
              where: { dossierId: { in: dossierIds }, investorId: { in: investorIds } },
            }),
            this.prisma.investorPledge.findMany({
              where: { dossierId: { in: dossierIds }, investorId: { in: investorIds } },
            }),
          ])
    const companyName = new Map(companies.map((c) => [c.id, c.name] as const))

    const items: WorkspacePositionsView['items'] = []
    for (const { candidature, dossier } of listed) {
      const consents = consented.filter((d) => d.dossierId === dossier.id)
      const readers = await this.consentedReaders(
        workspaceId,
        dossier.id,
        consents.map((d) => d.investorId),
      )
      const investors: WorkspacePositionsView['items'][number]['investors'] = []
      for (const consent of consents) {
        const reader = readers.get(consent.investorId)
        if (!reader) continue
        const mark = marks.find(
          (m) => m.dossierId === dossier.id && m.investorId === consent.investorId,
        )
        const pledge = pledges.find(
          (p) => p.dossierId === dossier.id && p.investorId === consent.investorId,
        )
        if (!mark && !pledge) continue
        investors.push({
          identity: structureIdentity(reader, workspaceId),
          disclosedAt: consent.createdAt,
          interest: mark ? { markedAt: mark.createdAt } : null,
          pledge: pledge
            ? {
                intention: pledgeIntentionOf(pledge.intention),
                amountEur: pledge.amountEur,
                updatedAt: pledge.updatedAt,
              }
            : null,
        })
      }
      investors.sort((a, b) => byName.compare(a.identity.name ?? '', b.identity.name ?? ''))
      items.push({
        candidatureId: candidature.id,
        dossier: { id: dossier.id, name: dossier.name },
        company: { name: companyName.get(dossier.companyId) ?? '' },
        investors,
        pledgedEur: investors.reduce((sum, i) => sum + (i.pledge?.amountEur ?? 0), 0),
      })
    }
    items.sort((a, b) => byName.compare(a.dossier.name, b.dossier.name))
    return { items }
  }
}
