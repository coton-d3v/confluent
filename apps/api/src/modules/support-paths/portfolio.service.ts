import { Injectable } from '@nestjs/common'
import {
  PORTFOLIO_PAGE_SIZE,
  SUPPORT_PHASES,
  supportProgress,
  type FinancingStatus,
  type SupportPhase,
  type SupportProgress,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import {
  CandidaturesService,
  type ReceivedCandidatureListItemView,
} from '../candidatures/candidatures.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import { STEP_ORDER } from './support-steps.service'

// @confluent/shared `portfolioQuerySchema`, parsed.
export interface PortfolioFilter {
  scheme?: string
  verified?: boolean
  financingStatus?: FinancingStatus
  phase?: SupportPhase
  step?: string
  page?: number
}

// @confluent/shared `portfolioSchema`.
export interface PortfolioView {
  counts: {
    total: number
    phases: Record<SupportPhase, number>
    steps: Array<{ stepId: string; label: string; count: number }>
  }
  total: number
  page: number
  pageSize: number
  items: Array<ReceivedCandidatureListItemView & { progress: SupportProgress }>
}

// A workspace's portfolio (ROADMAP E06.07): the candidatures it received, with their phase in its
// support path — computed at each read by the shared rule (`supportProgress`), never stored, so that
// it cannot drift from the path and its validations —, counted per phase and current step, filtered
// and paged. Read by whoever reads the candidatures it receives, through the candidatures' own rule
// (`CandidaturesService.receivedRows`: `404` outside the workspace, `403` for a member who is not
// one of its conseillers) and only over this workspace's sent candidatures, steps and validations.
//
// The phases are computed in memory over the workspace's candidatures matching the other filters:
// one row per candidature and one per validated step, a few thousand rows for a large structure;
// only the page is then described (company, request, eligibilities).
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
  ) {}

  async get(
    actor: WorkspaceActor,
    workspaceId: string,
    filter: PortfolioFilter = {},
  ): Promise<PortfolioView> {
    const { phase, step, page = 1, ...listFilter } = filter
    const rows = await this.candidatures.receivedRows(actor, workspaceId, listFilter)
    const steps = await this.prisma.supportStep.findMany({
      where: { workspaceId },
      orderBy: STEP_ORDER,
    })
    // The workspace's standing validations, by its steps (at most 30, on the `(step_id,
    // workspace_id)` index) rather than by a list of candidatures as long as the workspace's.
    const validations =
      rows.length === 0
        ? []
        : await this.prisma.candidatureStepValidation.findMany({
            where: {
              workspaceId,
              stepId: { in: steps.map((s) => s.id) },
              validatedAt: { not: null },
            },
          })
    const validatedAt = new Map(validations.map((v) => [`${v.candidatureId}:${v.stepId}`, v]))
    const progressed = rows.map((row) => ({
      row,
      progress: supportProgress(
        steps.map((s) => ({
          ...s,
          validatedAt: validatedAt.get(`${row.id}:${s.id}`)?.validatedAt ?? null,
        })),
      ),
    }))

    const phases = Object.fromEntries(SUPPORT_PHASES.map((p) => [p, 0])) as Record<
      SupportPhase,
      number
    >
    const atStep = new Map<string, number>()
    for (const { progress } of progressed) {
      phases[progress.phase] += 1
      if (progress.currentStep) {
        atStep.set(progress.currentStep.id, (atStep.get(progress.currentStep.id) ?? 0) + 1)
      }
    }

    const matching = progressed.filter(
      ({ progress }) =>
        (phase === undefined || progress.phase === phase) &&
        (step === undefined || progress.currentStep?.id === step),
    )
    const shown = matching.slice((page - 1) * PORTFOLIO_PAGE_SIZE, page * PORTFOLIO_PAGE_SIZE)
    const items = await this.candidatures.receivedListItems(
      workspaceId,
      shown.map((s) => s.row),
    )
    return {
      counts: {
        total: rows.length,
        phases,
        steps: steps
          .filter((s) => s.active)
          .map((s) => ({ stepId: s.id, label: s.label, count: atStep.get(s.id) ?? 0 })),
      },
      total: matching.length,
      page,
      pageSize: PORTFOLIO_PAGE_SIZE,
      items: items.map((item, i) => ({ ...item, progress: shown[i].progress })),
    }
  }
}
