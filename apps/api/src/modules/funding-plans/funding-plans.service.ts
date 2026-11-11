import { Injectable } from '@nestjs/common'
import {
  FUNDING_PLAN_LIMITS,
  fundingPlanLineStateOf,
  fundingPlanSideOf,
  fundingPlanTotals,
  fundingSourceFamilyOf,
  type FundingPlanLineState,
  type FundingPlanSide,
  type FundingPlanTotals,
  type FundingSourceFamily,
} from '@confluent/shared'
import type { Candidature, FundingPlanLine, FundingSourceCategory, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
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
}

// @confluent/shared `fundingPlanSchema`.
export interface FundingPlanView {
  candidatureId: string
  workspaceId: string
  lines: FundingPlanLineView[]
  categories: PlanCategoryView[]
  totals: FundingPlanTotals
}

export interface FundingPlanLineInput {
  categoryId: string
  amountEur: number
  state: FundingPlanLineState
  label?: string | null
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
@Injectable()
export class FundingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly audit: AuditService,
  ) {}

  async get(party: FundingPlanParty, candidatureId: string): Promise<FundingPlanView> {
    return this.view(await this.reach(party, candidatureId))
  }

  // A new line, for an active category of the candidature's workspace.
  async addLine(
    party: FundingPlanParty,
    candidatureId: string,
    input: FundingPlanLineInput,
  ): Promise<FundingPlanView> {
    const { candidature, result } = await this.write(party, candidatureId, async (tx, current) => {
      const count = await tx.fundingPlanLine.count({ where: { candidatureId: current.id } })
      if (count >= FUNDING_PLAN_LIMITS.linesPerPlan) throw FundingPlanErrors.tooMany()
      const category = await usableCategory(tx, current.workspaceId, input.categoryId)
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
      return { line, category }
    })
    await this.record(party, candidature, {
      change: 'created',
      lineId: result.line.id,
      line: snapshot(result.line, result.category),
    })
    return this.view(candidature)
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
    return this.view(candidature)
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
    return this.view(candidature)
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

  private async view(candidature: Candidature): Promise<FundingPlanView> {
    const [dossier, rows, categories] = await Promise.all([
      this.prisma.dossier.findUnique({ where: { id: candidature.dossierId } }),
      this.prisma.fundingPlanLine.findMany({
        where: { candidatureId: candidature.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.fundingSourceCategory.findMany({
        where: { workspaceId: candidature.workspaceId },
        orderBy: CATEGORY_ORDER,
      }),
    ])
    const rank = new Map(categories.map((c, i) => [c.id, i]))
    const byId = new Map(categories.map((c) => [c.id, c]))
    const lines = [...rows]
      .sort((a, b) => (rank.get(a.categoryId) ?? 0) - (rank.get(b.categoryId) ?? 0))
      .map((row) => lineView(row, byId.get(row.categoryId)!))
    return {
      candidatureId: candidature.id,
      workspaceId: candidature.workspaceId,
      lines,
      categories: categories.filter((c) => c.active).map(categoryView),
      totals: fundingPlanTotals(dossier?.amountEur ?? null, lines),
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

function lineView(row: FundingPlanLine, category: FundingSourceCategory): FundingPlanLineView {
  return {
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
