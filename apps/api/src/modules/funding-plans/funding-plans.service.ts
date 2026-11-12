import { Injectable } from '@nestjs/common'
import {
  FUNDING_PLAN_LIMITS,
  FUNDING_PLAN_PLEDGE_CONFIRMERS,
  confirmsPledge,
  fundingPlanLineStateOf,
  fundingPlanSideOf,
  fundingPlanTotals,
  fundingSourceFamilyOf,
  type FundingPlanLineState,
  type FundingPlanSide,
  type FundingPlanTotals,
  type FundingSourceFamily,
} from '@confluent/shared'
import type {
  Candidature,
  FundingPlanLine,
  FundingPlanPledgeLink,
  FundingSourceCategory,
  Prisma,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import type { InterestIdentityView } from '../opportunities/opportunities.service'
import {
  PositionsService,
  type AudiencePledge,
  type PledgeAudience,
} from '../opportunities/positions.service'
import { FundingPlanErrors } from './funding-plan-errors'

// Who acts on a plan: the owner of the request, or the workspace — its active conseillers and
// Confluent administrators, the people who read its candidatures (`canReviewCandidatures`).
export type FundingPlanParty = CandidatureParty

interface PlanCategoryView {
  id: string
  key: string
  label: string
  family: FundingSourceFamily
  active: boolean
}

// @confluent/shared `fundingPlanPledgeSchema` (E06.04).
export interface FundingPlanPledgeView {
  id: string
  identity: InterestIdentityView
  amountEur: number
  version: number | null
}

// @confluent/shared `fundingPlanLineSchema`: which side wrote the line last, never who.
export interface FundingPlanLineView {
  id: string
  category: PlanCategoryView
  label: string | null
  amountEur: number
  state: FundingPlanLineState
  version: number
  updatedAt: Date
  updatedBy: FundingPlanSide
  pledge: (FundingPlanPledgeView & { current: boolean }) | null
}

// @confluent/shared `fundingPlanSchema`.
export interface FundingPlanView {
  candidatureId: string
  workspaceId: string
  lines: FundingPlanLineView[]
  categories: PlanCategoryView[]
  totals: FundingPlanTotals
  pledges: { count: number; totalEur: number; confirmable: FundingPlanPledgeView[] }
}

// A pledge and its revision as the owner read them (E06.04).
export interface PledgeRef {
  id: string
  version: number
}

export interface FundingPlanLineInput {
  categoryId: string
  amountEur: number
  state: FundingPlanLineState
  label?: string | null
  // E06.04, the owner only: the new line confirms this pledge.
  pledge?: PledgeRef
}

export interface FundingPlanLineChange {
  version: number
  categoryId?: string
  amountEur?: number
  state?: FundingPlanLineState
  label?: string | null
}

const CATEGORY_ORDER = [{ position: 'asc' as const }, { key: 'asc' as const }]

// The financing plan of a request in one workspace (ROADMAP E06.03), carried by its candidature:
// lines of an amount and a state for the source categories of that workspace (E06.02); its target
// is the request's amount sought (E05.07), never copied. Kept by both parties of the candidature —
// its owner (a draft included), and the workspace once the candidature is sent —, through the
// candidatures' access rules (`CandidaturesService.findOwned` / `findReceived`), at each request
// and again under the candidature's row lock. Nobody else reads it: no other workspace, no
// investor, no share recipient, no MCP tool yet (E06.09). Every write locks the candidature row
// first, so the line limit and the expected versions are checked against what is really there; a
// line changed since the client read it is refused (409), never overwritten. Each change is
// journaled (`funding_plan_updated`) with its side and author; a line shows the side only.
//
// E06.04 (rules in @confluent/shared `funding-plan.schema.ts`): each side reads, apart from the
// totals, the pledges it is allowed to read by THE rules of E07.06/E07.07 (`PositionsService
// .pledgesFor`) that no line of the plan confirms at their current revision; the owner confirms a
// pledge they know one by one by tying it to a line, under the candidature's lock then the pledge's
// row lock (a withdrawal or a change of the pledge waits, or is seen), from the revision they read.
@Injectable()
export class FundingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly positions: PositionsService,
    private readonly audit: AuditService,
  ) {}

  async get(party: FundingPlanParty, candidatureId: string): Promise<FundingPlanView> {
    return this.view(party, await this.reach(party, candidatureId))
  }

  // A new line, for an active category of the candidature's workspace; for the owner, possibly
  // confirming a pledge (E06.04).
  async addLine(
    party: FundingPlanParty,
    candidatureId: string,
    input: FundingPlanLineInput,
  ): Promise<FundingPlanView> {
    if (input.pledge) assertConfirmer(party)
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const count = await tx.fundingPlanLine.count({ where: { candidatureId: current.id } })
      if (count >= FUNDING_PLAN_LIMITS.linesPerPlan) throw FundingPlanErrors.tooMany()
      const category = await usableCategory(tx, current.workspaceId, input.categoryId)
      if (input.pledge && !confirmsPledge(input.state)) throw FundingPlanErrors.pledgeState()
      const pledge = input.pledge
        ? await this.confirmablePledge(tx, current, input.pledge, null)
        : null
      const line = await tx.fundingPlanLine.create({
        data: {
          candidatureId: current.id,
          workspaceId: current.workspaceId,
          categoryId: category.id,
          label: input.label ?? null,
          amountEur: input.amountEur,
          state: input.state,
          ...authorOf(party),
        },
      })
      if (pledge) await linkPledge(tx, party, current, line.id, pledge)
      return { line, category, pledge }
    })
    await this.record(party, candidature, {
      change: 'created',
      lineId: result.line.id,
      line: snapshot(result.line, result.category),
    })
    if (result.pledge) {
      await this.record(party, candidature, {
        change: 'pledge_confirmed',
        lineId: result.line.id,
        pledgeId: result.pledge.id,
        pledgeVersion: result.pledge.version,
      })
    }
    return this.view(party, candidature)
  }

  // E06.04, the owner only: this line, at the version the client saw — in progress or obtained —,
  // confirms this pledge at the revision they read, in place of whatever pledge it confirmed. A
  // pledge another line of the plan holds is refused (released there first); the pledge this line
  // already confirms, still at that revision, changes nothing; at a new revision, it is confirmed
  // again.
  async confirmPledge(
    party: FundingPlanParty,
    candidatureId: string,
    lineId: string,
    input: { version: number; pledge: PledgeRef },
  ): Promise<FundingPlanView> {
    assertConfirmer(party)
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const line = await lineAt(tx, current.id, lineId, input.version)
      if (!confirmsPledge(fundingPlanLineStateOf(line.state))) throw FundingPlanErrors.pledgeState()
      const pledge = await this.confirmablePledge(tx, current, input.pledge, line.id)
      const held = await tx.fundingPlanPledgeLink.findFirst({ where: { lineId: line.id } })
      if (held?.pledgeId === pledge.id && held.pledgeVersion === pledge.version) {
        return { changed: false }
      }
      if (held) await tx.fundingPlanPledgeLink.delete({ where: { id: held.id } })
      await linkPledge(tx, party, current, line.id, pledge)
      await bump(tx, party, line)
      return { changed: true }
    })
    if (result.changed) {
      await this.record(party, candidature, {
        change: 'pledge_confirmed',
        lineId,
        pledgeId: input.pledge.id,
        pledgeVersion: input.pledge.version,
      })
    }
    return this.view(party, candidature)
  }

  // E06.04, the owner only: the line, at the version the client saw, confirms no pledge any more;
  // the line stays, the pledge counts as promised again. Without a pledge, nothing changes.
  async releasePledge(
    party: FundingPlanParty,
    candidatureId: string,
    lineId: string,
    version: number,
  ): Promise<FundingPlanView> {
    assertConfirmer(party)
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const line = await lineAt(tx, current.id, lineId, version)
      const held = await tx.fundingPlanPledgeLink.findFirst({ where: { lineId: line.id } })
      if (!held) return { released: null }
      await tx.fundingPlanPledgeLink.delete({ where: { id: held.id } })
      await bump(tx, party, line)
      return { released: held.pledgeId }
    })
    if (result.released) {
      await this.record(party, candidature, {
        change: 'pledge_released',
        lineId,
        pledgeId: result.released,
      })
    }
    return this.view(party, candidature)
  }

  // Only what is sent changes, from the version the client saw; nothing changed, nothing written.
  // Moving a line to another category needs that category active; a line already on a deactivated
  // one keeps it.
  async updateLine(
    party: FundingPlanParty,
    candidatureId: string,
    lineId: string,
    input: FundingPlanLineChange,
  ): Promise<FundingPlanView> {
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const line = await lineAt(tx, current.id, lineId, input.version)
      const changes: Array<{ field: string; from: unknown; to: unknown }> = []
      const data: Prisma.FundingPlanLineUncheckedUpdateInput = {}
      if (input.categoryId !== undefined && input.categoryId !== line.categoryId) {
        const [before, after] = await Promise.all([
          tx.fundingSourceCategory.findUnique({ where: { id: line.categoryId } }),
          usableCategory(tx, current.workspaceId, input.categoryId),
        ])
        data.categoryId = after.id
        changes.push({ field: 'category', from: before?.key ?? null, to: after.key })
      }
      for (const field of ['amountEur', 'state', 'label'] as const) {
        const value = input[field]
        if (value !== undefined && value !== line[field]) {
          data[field] = value as never
          changes.push({ field, from: line[field], to: value })
        }
      }
      if (changes.length === 0) return { changes }
      await tx.fundingPlanLine.update({
        where: { id: line.id },
        data: { ...data, version: line.version + 1, ...authorOf(party) },
      })
      return { changes }
    })
    if (result.changes.length > 0) {
      await this.record(party, candidature, {
        change: 'updated',
        lineId,
        changes: result.changes,
      })
    }
    return this.view(party, candidature)
  }

  async deleteLine(
    party: FundingPlanParty,
    candidatureId: string,
    lineId: string,
    version: number,
  ): Promise<FundingPlanView> {
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const line = await lineAt(tx, current.id, lineId, version)
      const category = await tx.fundingSourceCategory.findUnique({ where: { id: line.categoryId } })
      await tx.fundingPlanLine.delete({ where: { id: line.id } })
      return { line, category }
    })
    await this.record(party, candidature, {
      change: 'deleted',
      lineId,
      line: snapshot(result.line, result.category),
    })
    return this.view(party, candidature)
  }

  // The pledge the owner confirms, under its row lock (`FOR SHARE`: a withdrawal or a change waits
  // for this transaction, or happened before and is seen): on the candidature's request, still at
  // the revision they read, and still one they know one by one — its investor reads the request
  // now and shows both name and amount. Anything else, an unknown id included, gets the same `409`.
  // `lineId`: the line about to hold it, which may already; any other line of the plan may not.
  private async confirmablePledge(
    tx: Prisma.TransactionClient,
    candidature: Candidature,
    ref: PledgeRef,
    lineId: string | null,
  ): Promise<PledgeRef> {
    await tx.$queryRaw`SELECT 1 FROM "investor_pledges"
      WHERE "id" = ${ref.id} AND "dossier_id" = ${candidature.dossierId} FOR SHARE`
    const known = (
      await this.positions.pledgesFor({ side: 'owner' }, candidature.dossierId, tx)
    ).find((p) => p.pledge.id === ref.id)
    if (!known?.individual || known.pledge.version !== ref.version) {
      throw FundingPlanErrors.pledgeChanged()
    }
    const elsewhere = await tx.fundingPlanPledgeLink.findFirst({
      where: { candidatureId: candidature.id, pledgeId: ref.id },
    })
    if (elsewhere && elsewhere.lineId !== lineId) throw FundingPlanErrors.pledgeHeld()
    return { id: known.pledge.id, version: known.pledge.version }
  }

  // The candidature as the party may reach it (`404`/`403` of the candidatures' rules).
  private reach(party: FundingPlanParty, candidatureId: string): Promise<Candidature> {
    return this.candidatures.reachAs(party, candidatureId)
  }

  // Nothing is told to whoever may not reach the candidature; then its row is locked and the access
  // read again after the lock (`CandidaturesService.lockAs`).
  private async write<T>(
    party: FundingPlanParty,
    candidatureId: string,
    fn: (tx: Prisma.TransactionClient, candidature: Candidature) => Promise<T>,
  ): Promise<{ candidature: Candidature; result: T }> {
    await this.reach(party, candidatureId)
    return this.prisma.$transaction(async (tx) => {
      const candidature = await this.candidatures.lockAs(tx, party, candidatureId)
      return { candidature, result: await fn(tx, candidature) }
    })
  }

  private async view(party: FundingPlanParty, candidature: Candidature): Promise<FundingPlanView> {
    const audience: PledgeAudience =
      party.side === 'owner'
        ? { side: 'owner' }
        : { side: 'workspace', workspaceId: party.workspaceId }
    const [dossier, rows, categories, links, seen] = await Promise.all([
      this.prisma.dossier.findUnique({ where: { id: candidature.dossierId } }),
      this.prisma.fundingPlanLine.findMany({
        where: { candidatureId: candidature.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.fundingSourceCategory.findMany({
        where: { workspaceId: candidature.workspaceId },
        orderBy: CATEGORY_ORDER,
      }),
      this.prisma.fundingPlanPledgeLink.findMany({ where: { candidatureId: candidature.id } }),
      this.positions.pledgesFor(audience, candidature.dossierId),
    ])
    const rank = new Map(categories.map((c, i) => [c.id, i]))
    const byId = new Map(categories.map((c) => [c.id, c]))
    const pledges = planPledges(audience, rows, links, seen)
    const lines = [...rows]
      .sort((a, b) => (rank.get(a.categoryId) ?? 0) - (rank.get(b.categoryId) ?? 0))
      .map((row) => lineView(row, byId.get(row.categoryId)!, pledges.onLine.get(row.id) ?? null))
    return {
      candidatureId: candidature.id,
      workspaceId: candidature.workspaceId,
      lines,
      categories: categories.filter((c) => c.active).map(categoryView),
      totals: fundingPlanTotals(dossier?.amountEur ?? null, lines),
      pledges: pledges.summary,
    }
  }

  private record(
    party: FundingPlanParty,
    candidature: Candidature,
    details: Record<string, unknown>,
  ) {
    return this.audit.record({
      actionType: 'funding_plan_updated',
      actorId: party.side === 'owner' ? party.userId : party.actor.id,
      dossierId: candidature.dossierId,
      metadata: {
        candidatureId: candidature.id,
        workspaceId: candidature.workspaceId,
        side: party.side,
        ...details,
      },
    })
  }
}

// THE count of E06.04 for one side: of the pledges it reads (`seen`), those a line of this plan
// confirms at their current revision count as that line only; every other one is promised. A line
// tells which pledge it confirms only if this side knows that pledge one by one. The owner may
// confirm the pledges they know one by one that no line holds. Links whose line is gone are ignored.
export function planPledges(
  audience: PledgeAudience,
  lines: ReadonlyArray<Pick<FundingPlanLine, 'id'>>,
  links: ReadonlyArray<Pick<FundingPlanPledgeLink, 'lineId' | 'pledgeId' | 'pledgeVersion'>>,
  seen: readonly AudiencePledge[],
): {
  onLine: Map<string, FundingPlanPledgeView & { current: boolean }>
  summary: FundingPlanView['pledges']
} {
  const ref = (p: AudiencePledge): FundingPlanPledgeView => ({
    id: p.pledge.id,
    identity: p.identity,
    amountEur: p.pledge.amountEur,
    version: audience.side === 'owner' ? p.pledge.version : null,
  })
  const lineIds = new Set(lines.map((l) => l.id))
  const held = links.filter((l) => lineIds.has(l.lineId))
  const byPledge = new Map(seen.map((p) => [p.pledge.id, p] as const))
  const onLine = new Map<string, FundingPlanPledgeView & { current: boolean }>()
  const confirmed = new Set<string>()
  for (const link of held) {
    const pledge = byPledge.get(link.pledgeId)
    if (!pledge) continue
    const current = pledge.pledge.version === link.pledgeVersion
    if (current) confirmed.add(pledge.pledge.id)
    if (pledge.individual) onLine.set(link.lineId, { ...ref(pledge), current })
  }
  const promised = seen.filter((p) => !confirmed.has(p.pledge.id))
  const confirmable =
    audience.side === 'owner'
      ? seen
          .filter((p) => p.individual && !held.some((l) => l.pledgeId === p.pledge.id))
          .sort(
            (a, b) =>
              b.pledge.amountEur - a.pledge.amountEur ||
              byName.compare(a.identity.name ?? '', b.identity.name ?? '') ||
              a.pledge.id.localeCompare(b.pledge.id),
          )
          .map(ref)
      : []
  return {
    onLine,
    summary: {
      count: promised.length,
      totalEur: promised.reduce((sum, p) => sum + p.pledge.amountEur, 0),
      confirmable,
    },
  }
}

const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

// Only the sides `FUNDING_PLAN_PLEDGE_CONFIRMERS` names confirm or release a pledge.
function assertConfirmer(party: FundingPlanParty) {
  if (!FUNDING_PLAN_PLEDGE_CONFIRMERS.includes(party.side))
    throw FundingPlanErrors.pledgeOwnerOnly()
}

async function linkPledge(
  tx: Prisma.TransactionClient,
  party: FundingPlanParty,
  candidature: Candidature,
  lineId: string,
  pledge: PledgeRef,
) {
  await tx.fundingPlanPledgeLink.create({
    data: {
      lineId,
      candidatureId: candidature.id,
      dossierId: candidature.dossierId,
      pledgeId: pledge.id,
      pledgeVersion: pledge.version,
      confirmedById: party.side === 'owner' ? party.userId : party.actor.id,
    },
  })
}

// A change of what the line confirms is a change of the line: its version grows.
function bump(tx: Prisma.TransactionClient, party: FundingPlanParty, line: FundingPlanLine) {
  return tx.fundingPlanLine.update({
    where: { id: line.id },
    data: { version: line.version + 1, ...authorOf(party) },
  })
}

function authorOf(party: FundingPlanParty) {
  return {
    updatedBySide: party.side,
    updatedById: party.side === 'owner' ? party.userId : party.actor.id,
  }
}

// A category a line may take: one of the workspace's (`400` alike for an unknown one and another
// workspace's — the composite foreign key refuses it anyway), still offered (`409` once
// deactivated).
async function usableCategory(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryId: string,
): Promise<FundingSourceCategory> {
  const category = await tx.fundingSourceCategory.findFirst({
    where: { id: categoryId, workspaceId },
  })
  if (!category) throw FundingPlanErrors.categoryUnknown()
  if (!category.active) throw FundingPlanErrors.categoryInactive(category.label)
  return category
}

// The line of this plan, at the version the client saw.
async function lineAt(
  tx: Prisma.TransactionClient,
  candidatureId: string,
  lineId: string,
  version: number,
): Promise<FundingPlanLine> {
  const line = await tx.fundingPlanLine.findFirst({ where: { id: lineId, candidatureId } })
  if (!line) throw FundingPlanErrors.lineNotFound()
  if (line.version !== version) throw FundingPlanErrors.lineChanged(line.version)
  return line
}

function snapshot(line: FundingPlanLine, category: FundingSourceCategory | null) {
  return {
    category: category?.key ?? null,
    label: line.label,
    amountEur: line.amountEur,
    state: line.state,
  }
}

function categoryView(row: FundingSourceCategory): PlanCategoryView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    family: fundingSourceFamilyOf(row.family),
    active: row.active,
  }
}

function lineView(
  row: FundingPlanLine,
  category: FundingSourceCategory,
  pledge: FundingPlanLineView['pledge'],
): FundingPlanLineView {
  return {
    pledge,
    id: row.id,
    category: categoryView(category),
    label: row.label,
    amountEur: row.amountEur,
    state: fundingPlanLineStateOf(row.state),
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: fundingPlanSideOf(row.updatedBySide),
  }
}
