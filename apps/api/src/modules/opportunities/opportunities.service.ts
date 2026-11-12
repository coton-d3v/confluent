import { Injectable, NotFoundException } from '@nestjs/common'
import {
  OPPORTUNITY_PAGE_SIZE,
  financingTypesOf,
  highestAccessLevel,
  type AccessLevel,
  type FinancingType,
  type OpportunitySort,
  type OpportunitySourceKind,
  type PledgeIntention,
  pledgeIntentionOf,
} from '@confluent/shared'
import type { Dossier, InvestorInterest, InvestorPledge, Prisma, User } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { grantedLevel, presentationForShare } from '../dossiers/financeur-access'
import { listedPoolPublications } from '../pool-publications/pool-publication'
import { ShareLinksService, type RecipientView } from '../share-links/share-links.service'
import { readsPool } from '../workspaces/workspace-access'

// The reader of opportunities: the signed-in account, its email read from the database at each
// request (`JwtStrategy`). Nothing else identifies them — never an id given by the client.
export interface OpportunityReader {
  id: string
  email: string
}

// @confluent/shared `opportunitiesQuerySchema`, parsed.
export interface OpportunityFilter {
  q?: string
  sector?: string
  amountMin?: number
  amountMax?: number
  financingType?: FinancingType
  source?: OpportunitySourceKind
  workspace?: string
  sort?: OpportunitySort
  page?: number
}

interface WorkspaceRef {
  id: string
  name: string
}

// @confluent/shared `opportunitySourceSchema`.
export type OpportunitySourceView =
  | { kind: 'share'; accessLevel: AccessLevel; since: Date }
  | { kind: 'pool'; accessLevel: AccessLevel; since: Date; workspace: WorkspaceRef }

// @confluent/shared `opportunityInterestSchema` (E07.05): the reader's own mark.
export interface OpportunityInterestView {
  markedAt: Date
  nameVisible: boolean
}

// @confluent/shared `interestIdentitySchema` (E07.05).
export interface InterestIdentityView {
  name: string | null
  organizations: string[]
}

// @confluent/shared `opportunityPledgeSchema` (E07.06): the reader's own pledge.
export interface OpportunityPledgeView {
  intention: PledgeIntention
  amountEur: number
  comment: string | null
  showName: boolean
  showAmount: boolean
  version: number
  pledgedAt: Date
  updatedAt: Date
}

// @confluent/shared `opportunityAccessSchema`.
export interface OpportunityAccessView {
  accessLevel: AccessLevel
  sources: OpportunitySourceView[]
  receivedAt: Date
  interest: OpportunityInterestView | null
  pledge: OpportunityPledgeView | null
}

// One request the reader reaches, before its projection; the share ids are for the journal only,
// the organizations (the reader's, in the workspaces whose pools bring it) for their name (E07.05),
// each of them by workspace for the structures they may show their position to (E07.07).
export interface ReachedOpportunity extends Omit<OpportunityAccessView, 'interest' | 'pledge'> {
  dossier: Dossier
  shareLinkIds: string[]
  organizations: string[]
  organizationIn: Map<string, string | null>
}

// @confluent/shared `opportunityStructureSchema` (E07.07).
export interface OpportunityStructureView {
  workspace: WorkspaceRef
  shownAs: InterestIdentityView
  disclosure: { id: string; disclosedAt: Date } | null
}

export type ListedDossier = Pick<
  Dossier,
  | 'id'
  | 'name'
  | 'sector'
  | 'maturityStage'
  | 'tagTechnologique'
  | 'summary'
  | 'amountEur'
  | 'financingTypes'
  | 'publicationStatus'
>

// @confluent/shared `opportunitiesSchema`.
export interface OpportunitiesView {
  counts: {
    total: number
    shares: number
    pools: Array<{ workspace: WorkspaceRef; count: number }>
    sectors: Array<{ value: string; count: number }>
    financingTypes: Array<{ value: FinancingType; count: number }>
  }
  total: number
  page: number
  pageSize: number
  items: Array<OpportunityAccessView & { dossier: ListedDossier }>
}

// @confluent/shared `opportunitySchema`.
export type OpportunityView = RecipientView & {
  opportunity: OpportunityAccessView & {
    shownAs: InterestIdentityView
    structures: OpportunityStructureView[]
  }
}

export const opportunityNotFound = () =>
  new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunité introuvable.' })

// The request's row, held for the rest of the transaction: who reads it changes under the same lock
// (shares E07.01, pool publications E07.02, archiving E06.01), so a mark of interest (E07.05) or a
// pledge (E07.06) is decided on who reads it once those changes are committed, and two writes of the
// same investor — a double click, two tabs — follow one another. No owner check: the reader is no
// owner (`OpportunitiesService.reachOne` decides).
export async function lockRequest(tx: Prisma.TransactionClient, dossierId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossierId} FOR UPDATE`
}

// An investor who reads a request as an opportunity now, and how (`OpportunitiesService.readersNow`).
export interface CurrentReader {
  investor: User
  reached: ReachedOpportunity
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Accents and case ignored: « Énergie » matches « energie ».
const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

// ROADMAP E07.03 — an investor's opportunities (rules in @confluent/shared `opportunity.schema.ts`).
//
// Who reaches what is read at each request, closed by default: a direct share counts while it is
// active and sent to the reader's address (the share link's own rule, E07.01); a pool counts while
// the reader is an active investisseur of its workspace (`readsPool`) and the publication is listed
// there (`listedPoolPublications`, THE rule of the pool, E07.02). The reader's own requests are no
// opportunity. A request reached several ways is one opportunity, read at the widest level.
//
// What is read of it is THE projection of a nominative share at that level
// (`ShareLinksService.recipientView`, `DossiersService.projectEachForLevel`): the list's filters,
// sorts and counts only use what that projection shows. They are computed in memory over the
// reader's opportunities — as many rows as requests they reach — and only the page is returned.
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dossiers: DossiersService,
    private readonly shareLinks: ShareLinksService,
    private readonly audit: AuditService,
  ) {}

  async list(
    reader: OpportunityReader,
    filter: OpportunityFilter = {},
  ): Promise<OpportunitiesView> {
    const { reached, pools } = await this.reach(reader)
    const projected = await this.dossiers.projectEachForLevel(
      reached.map((r) => ({ dossier: r.dossier, level: r.accessLevel })),
    )
    const ids = reached.map((r) => r.dossier.id)
    const [interests, pledges] = await Promise.all([
      this.interestsOf(reader, ids),
      this.pledgesOf(reader, ids),
    ])
    const rows = reached.map((r, i) => ({
      access: r,
      dossier: listedDossier(presentationForShare(projected[i])),
    }))

    const sectors = new Map<string, number>()
    const types = new Map<FinancingType, number>()
    for (const { dossier } of rows) {
      if (dossier.sector) sectors.set(dossier.sector, (sectors.get(dossier.sector) ?? 0) + 1)
      for (const t of financingTypesOf(dossier.financingTypes))
        types.set(t, (types.get(t) ?? 0) + 1)
    }

    const matching = rows.filter((row) => matches(row, filter))
    matching.sort(ordering(filter.sort ?? 'recent'))
    const page = filter.page ?? 1
    const shown = matching.slice((page - 1) * OPPORTUNITY_PAGE_SIZE, page * OPPORTUNITY_PAGE_SIZE)
    return {
      counts: {
        total: rows.length,
        shares: reached.filter((r) => r.sources.some((s) => s.kind === 'share')).length,
        pools: pools.map((workspace) => ({
          workspace,
          count: reached.filter((r) =>
            r.sources.some((s) => s.kind === 'pool' && s.workspace.id === workspace.id),
          ).length,
        })),
        sectors: [...sectors]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => byName.compare(a.value, b.value)),
        financingTypes: financingTypesOf([...types.keys()]).map((value) => ({
          value,
          count: types.get(value)!,
        })),
      },
      total: matching.length,
      page,
      pageSize: OPPORTUNITY_PAGE_SIZE,
      items: shown.map(({ access, dossier }) => ({
        accessLevel: access.accessLevel,
        sources: access.sources,
        receivedAt: access.receivedAt,
        interest: interests.get(access.dossier.id) ?? null,
        pledge: pledges.get(access.dossier.id) ?? null,
        dossier,
      })),
    }
  }

  // One opportunity, as a recipient of a nominative share at its level reads it — the same
  // projection (`recipientView`). Anything the reader does not reach — an unknown request, one only
  // shared with someone else, a pool they are no investor of, a publication withdrawn or paused, a
  // revoked share — is the same `404`. Each reading is journaled once (`opportunity_viewed`), on the
  // reader's direct share if they have one, so that it counts as that share's view and once only.
  async get(reader: OpportunityReader, dossierId: string): Promise<OpportunityView> {
    const found = await this.reachOne(reader, dossierId)
    if (!found) throw opportunityNotFound()
    const view = await this.shareLinks.recipientView(found.dossier, found.accessLevel)
    const [interests, pledges, account, disclosures] = await Promise.all([
      this.interestsOf(reader, [found.dossier.id]),
      this.pledgesOf(reader, [found.dossier.id]),
      this.prisma.user.findUnique({ where: { id: reader.id } }),
      this.prisma.investorPositionDisclosure.findMany({
        where: { investorId: reader.id, dossierId: found.dossier.id },
      }),
    ])
    await this.audit.record({
      actionType: 'opportunity_viewed',
      actorId: reader.id,
      dossierId: found.dossier.id,
      shareLinkId: found.shareLinkIds[0] ?? null,
      metadata: {
        accessLevel: found.accessLevel,
        shareLinkIds: found.shareLinkIds,
        workspaceIds: found.sources.flatMap((s) => (s.kind === 'pool' ? [s.workspace.id] : [])),
      },
    })
    const { accessLevel, sources, receivedAt } = found
    return {
      ...view,
      opportunity: {
        accessLevel,
        sources,
        receivedAt,
        interest: interests.get(found.dossier.id) ?? null,
        pledge: pledges.get(found.dossier.id) ?? null,
        shownAs: interestIdentity(account ?? {}, found.organizations),
        // E07.07: the structures whose pool brings it, each with the reader's consent, if given.
        structures: found.sources.flatMap((s) => {
          if (s.kind !== 'pool') return []
          const consent = disclosures.find(
            (d) => d.investorId === reader.id && d.workspaceId === s.workspace.id,
          )
          const organization = found.organizationIn.get(s.workspace.id)
          return [
            {
              workspace: s.workspace,
              shownAs: interestIdentity(account ?? {}, organization ? [organization] : []),
              disclosure: consent ? { id: consent.id, disclosedAt: consent.createdAt } : null,
            },
          ]
        }),
      },
    }
  }

  // Those of these requests the reader reads as opportunities now (THE rule, as `list` applies it),
  // each with how and the list's part of its projection at its level — what « Mes positionnements »
  // (E07.07) shows of a request; nothing for the others.
  async readable(
    reader: OpportunityReader,
    dossierIds: string[],
  ): Promise<Map<string, { access: ReachedOpportunity; dossier: ListedDossier }>> {
    if (dossierIds.length === 0) return new Map()
    const wanted = new Set(dossierIds)
    const reached = (await this.reach(reader)).reached.filter((r) => wanted.has(r.dossier.id))
    const projected = await this.dossiers.projectEachForLevel(
      reached.map((r) => ({ dossier: r.dossier, level: r.accessLevel })),
    )
    return new Map(
      reached.map(
        (access, i) =>
          [
            access.dossier.id,
            { access, dossier: listedDossier(presentationForShare(projected[i])) },
          ] as const,
      ),
    )
  }

  // THE rule of who reads one request as an opportunity, and how, as `get` applies it: also what a
  // mark of interest (E07.05) or a pledge (E07.06) requires and what makes it count. `db`: the
  // caller's transaction.
  async reachOne(
    reader: OpportunityReader,
    dossierId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ReachedOpportunity | null> {
    const [found] = (await this.reach(reader, dossierId, db)).reached
    return found ?? null
  }

  // Those of these investors who read the request as an opportunity now — an active, verified
  // account reaching it by THE rule (`reachOne`) —, each with how: the only ones whose marks of
  // interest (E07.05) and pledges (E07.06) its owner sees.
  async readersNow(dossierId: string, investorIds: string[]): Promise<Map<string, CurrentReader>> {
    const ids = new Set(investorIds)
    const readers = new Map<string, CurrentReader>()
    if (ids.size === 0) return readers
    const investors = await this.prisma.user.findMany({ where: { id: { in: [...ids] } } })
    for (const investor of investors) {
      if (!ids.has(investor.id) || !investor.isActive || investor.emailVerifiedAt === null) continue
      const reached = await this.reachOne(investor, dossierId)
      if (reached) readers.set(investor.id, { investor, reached })
    }
    return readers
  }

  // The reader's own marks of interest on these requests (E07.05).
  private async interestsOf(
    reader: OpportunityReader,
    dossierIds: string[],
  ): Promise<Map<string, OpportunityInterestView>> {
    if (dossierIds.length === 0) return new Map()
    const marks = await this.prisma.investorInterest.findMany({
      where: { investorId: reader.id, dossierId: { in: dossierIds } },
    })
    return new Map(
      marks
        .filter((m) => m.investorId === reader.id)
        .map((m) => [m.dossierId, interestView(m)] as const),
    )
  }

  // The reader's own pledges on these requests (E07.06).
  private async pledgesOf(
    reader: OpportunityReader,
    dossierIds: string[],
  ): Promise<Map<string, OpportunityPledgeView>> {
    if (dossierIds.length === 0) return new Map()
    const pledges = await this.prisma.investorPledge.findMany({
      where: { investorId: reader.id, dossierId: { in: dossierIds } },
    })
    return new Map(
      pledges
        .filter((p) => p.investorId === reader.id)
        .map((p) => [p.dossierId, pledgeView(p)] as const),
    )
  }

  // The requests the reader reaches, each with its ways and level; `dossierId` narrows to one. Also
  // the workspaces whose pool they read, for the counts.
  private async reach(
    reader: OpportunityReader,
    dossierId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ reached: ReachedOpportunity[]; pools: WorkspaceRef[] }> {
    const [links, memberships] = await Promise.all([
      db.shareLink.findMany({
        where: {
          recipientEmail: { equals: reader.email, mode: 'insensitive' },
          status: 'active',
          ...(dossierId === undefined ? {} : { dossierId }),
        },
      }),
      // Every membership of the reader: THE rule (`readsPool`) decides which pools they read.
      db.workspaceMembership.findMany({ where: { userId: reader.id } }),
    ])
    // The share link's rule, whatever the query matched: active, and sent to this very address.
    const shares = links.filter(
      (l) => l.status === 'active' && sameEmail(l.recipientEmail, reader.email),
    )
    const poolMemberships = memberships.filter((m) => m.userId === reader.id && readsPool(m))
    const poolIds = poolMemberships.map((m) => m.workspaceId)
    const organizationIn = new Map(
      poolMemberships.map((m) => [m.workspaceId, m.organization?.trim() || null] as const),
    )
    const [workspaces, listed] = await Promise.all([
      poolIds.length === 0
        ? Promise.resolve([])
        : db.workspace.findMany({
            where: { id: { in: poolIds } },
            select: { id: true, name: true },
          }),
      listedPoolPublications(db, poolIds, dossierId),
    ])
    const pools = workspaces
      .map((w) => ({ id: w.id, name: w.name }))
      .sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id))
    const workspaceById = new Map(pools.map((w) => [w.id, w]))

    const sharedIds = [...new Set(shares.map((l) => l.dossierId))].filter(
      (id) => !listed.some((p) => p.dossier.id === id),
    )
    const sharedDossiers =
      sharedIds.length === 0 ? [] : await db.dossier.findMany({ where: { id: { in: sharedIds } } })
    const dossierById = new Map<string, Dossier>([
      ...sharedDossiers.map((d) => [d.id, d] as const),
      ...listed.map((p) => [p.dossier.id, p.dossier] as const),
    ])

    const byDossier = new Map<
      string,
      { sources: OpportunitySourceView[]; shareLinkIds: string[] }
    >()
    const entry = (id: string) => {
      const found = byDossier.get(id) ?? { sources: [], shareLinkIds: [] }
      byDossier.set(id, found)
      return found
    }
    for (const link of shares) {
      const e = entry(link.dossierId)
      e.shareLinkIds.push(link.id)
      e.sources.push({
        kind: 'share',
        accessLevel: grantedLevel(link.accessLevel),
        since: link.createdAt,
      })
    }
    for (const { publication, candidature } of listed) {
      const workspace = workspaceById.get(publication.workspaceId)
      if (!workspace) continue
      entry(candidature.dossierId).sources.push({
        kind: 'pool',
        accessLevel: grantedLevel(publication.accessLevel),
        since: publication.consentedAt,
        workspace,
      })
    }

    const reached: ReachedOpportunity[] = []
    for (const [id, { sources, shareLinkIds }] of byDossier) {
      const dossier = dossierById.get(id)
      // The reader's own requests are theirs, not opportunities.
      if (!dossier || dossier.userId === reader.id || sources.length === 0) continue
      sources.sort(sourceOrder)
      const pools = sources.flatMap((s) => (s.kind === 'pool' ? [s.workspace.id] : []))
      const organizations = pools.flatMap((w) => organizationIn.get(w) ?? [])
      reached.push({
        dossier,
        accessLevel: highestAccessLevel(sources.map((s) => s.accessLevel))!,
        sources,
        receivedAt: new Date(Math.max(...sources.map((s) => s.since.getTime()))),
        shareLinkIds,
        organizations: [...new Set(organizations)],
        organizationIn: new Map(pools.map((w) => [w, organizationIn.get(w) ?? null] as const)),
      })
    }
    return { reached, pools }
  }
}

export function interestView(mark: InvestorInterest): OpportunityInterestView {
  return { markedAt: mark.createdAt, nameVisible: mark.nameVisible }
}

export function pledgeView(pledge: InvestorPledge): OpportunityPledgeView {
  return {
    intention: pledgeIntentionOf(pledge.intention),
    amountEur: pledge.amountEur,
    comment: pledge.comment,
    showName: pledge.showName,
    showAmount: pledge.showAmount,
    version: pledge.version,
    pledgedAt: pledge.createdAt,
    updatedAt: pledge.updatedAt,
  }
}

// Who an investor is to the owner when they show their name (E07.05, D05): their account's name,
// never their address, and their organizations in the pools that bring them the request.
export function interestIdentity(
  account: Partial<Pick<User, 'firstName' | 'lastName'>>,
  organizations: string[],
): InterestIdentityView {
  const name = [account.firstName, account.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' ')
  return { name: name === '' ? null : name, organizations }
}

// The direct share first, then the pools by workspace name.
function sourceOrder(a: OpportunitySourceView, b: OpportunitySourceView): number {
  if (a.kind !== b.kind) return a.kind === 'share' ? -1 : 1
  if (a.kind === 'pool' && b.kind === 'pool') {
    return (
      byName.compare(a.workspace.name, b.workspace.name) ||
      a.workspace.id.localeCompare(b.workspace.id)
    )
  }
  return a.since.getTime() - b.since.getTime()
}

function listedDossier(d: Dossier): ListedDossier {
  return {
    id: d.id,
    name: d.name,
    sector: d.sector,
    maturityStage: d.maturityStage,
    tagTechnologique: d.tagTechnologique,
    summary: d.summary,
    amountEur: d.amountEur,
    financingTypes: financingTypesOf(d.financingTypes),
    publicationStatus: d.publicationStatus,
  }
}

type Row = { access: ReachedOpportunity; dossier: ListedDossier }

// Every filter on what the projection shows: a hidden sector, amount or type matches nothing.
function matches({ access, dossier }: Row, f: OpportunityFilter): boolean {
  if (f.q !== undefined) {
    const needle = searchable(f.q)
    const haystack = searchable(`${dossier.name}\n${dossier.summary ?? ''}`)
    if (!haystack.includes(needle)) return false
  }
  if (f.sector !== undefined && searchable(dossier.sector ?? '') !== searchable(f.sector)) {
    return false
  }
  if (
    f.amountMin !== undefined &&
    (dossier.amountEur === null || dossier.amountEur < f.amountMin)
  ) {
    return false
  }
  if (
    f.amountMax !== undefined &&
    (dossier.amountEur === null || dossier.amountEur > f.amountMax)
  ) {
    return false
  }
  if (f.financingType !== undefined && !dossier.financingTypes.includes(f.financingType)) {
    return false
  }
  if (f.source !== undefined && !access.sources.some((s) => s.kind === f.source)) return false
  if (
    f.workspace !== undefined &&
    !access.sources.some((s) => s.kind === 'pool' && s.workspace.id === f.workspace)
  ) {
    return false
  }
  return true
}

// Each sort, then the latest received, then the id: a stable order across pages.
function ordering(sort: OpportunitySort): (a: Row, b: Row) => number {
  const recent = (a: Row, b: Row) =>
    b.access.receivedAt.getTime() - a.access.receivedAt.getTime() ||
    a.dossier.id.localeCompare(b.dossier.id)
  // A request without a shown amount comes last, whichever the direction.
  const amount = (direction: 1 | -1) => (a: Row, b: Row) => {
    const x = a.dossier.amountEur
    const y = b.dossier.amountEur
    if (x === null || y === null) return x === y ? recent(a, b) : x === null ? 1 : -1
    return (x - y) * direction || recent(a, b)
  }
  switch (sort) {
    case 'amount_desc':
      return amount(-1)
    case 'amount_asc':
      return amount(1)
    case 'name':
      return (a, b) => byName.compare(a.dossier.name, b.dossier.name) || recent(a, b)
    default:
      return recent
  }
}
