import { Injectable } from '@nestjs/common'
import { supportProgress, type SupportProgress, type SupportStepChange } from '@confluent/shared'
import {
  Prisma,
  type Candidature,
  type CandidatureStepValidation,
  type SupportStep,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import type { WorkspaceActor } from '../workspaces/workspace-access'
import { SupportPathErrors } from './support-path-errors'
import { STEP_ORDER } from './support-steps.service'

// @confluent/shared `candidatureSupportStepSchema`: validated or not, and when — never by whom.
export interface SupportPathStepView {
  id: string
  key: string
  label: string
  explanation: string | null
  active: boolean
  validatedAt: Date | null
  version: number
}

interface MemberView {
  email: string
  firstName: string | null
  lastName: string | null
}

// @confluent/shared `candidatureSupportPathSchema`.
export interface SupportPathView {
  candidatureId: string
  workspaceId: string
  steps: SupportPathStepView[]
  // E06.07: its phase.
  progress: SupportProgress
}

// @confluent/shared `receivedSupportPathSchema`: who validated, and the history.
export interface ReceivedSupportPathView extends SupportPathView {
  steps: Array<SupportPathStepView & { validatedBy: MemberView | null }>
  history: Array<{
    stepId: string
    stepLabel: string
    change: SupportStepChange
    changedAt: Date
    actor: MemberView | null
  }>
}

// A candidature's support path (ROADMAP E06.06): the steps of its workspace's path, each validated
// or not. The owner of the request reads it — a draft included, to know what the structure will go
// through with them —: the steps, their explanations, what was validated and when, never by whom.
// The workspace — its active conseillers and Confluent administrators, on a candidature sent to it —
// reads it with its validators and history, and alone validates a step or withdraws its validation
// (« rouvrir »), through the candidatures' access rules (`CandidaturesService.reachAs` / `lockAs`),
// at each request and again under the candidature's row lock. Nobody else reads it: no other
// workspace, no investor, no share recipient, no MCP tool yet (E06.09). A step changed since the
// client read it is refused (409), never overwritten; each change is dated, kept in the step's
// history and journaled (`candidature_support_step_updated`).
@Injectable()
export class SupportPathsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatures: CandidaturesService,
    private readonly audit: AuditService,
  ) {}

  async getForOwner(userId: string, candidatureId: string): Promise<SupportPathView> {
    const candidature = await this.candidatures.reachAs({ side: 'owner', userId }, candidatureId)
    const { steps, shown, byStep } = await this.state(candidature)
    return {
      candidatureId: candidature.id,
      workspaceId: candidature.workspaceId,
      steps: shown.map((step) => stepView(step, byStep.get(step.id))),
      progress: progressOf(steps, byStep),
    }
  }

  async getReceived(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
  ): Promise<ReceivedSupportPathView> {
    const party: CandidatureParty = { side: 'workspace', actor, workspaceId }
    return this.receivedView(await this.candidatures.reachAs(party, candidatureId))
  }

  // Validates the step (`validated: true`) or withdraws its validation (`false`), from the version of
  // the step the client saw (`0`: never validated). The same state again writes nothing. A step of
  // another workspace is unknown (`404`); a deactivated one is frozen (`409`).
  async setValidation(
    actor: WorkspaceActor,
    workspaceId: string,
    candidatureId: string,
    stepId: string,
    input: { validated: boolean; version: number },
  ): Promise<ReceivedSupportPathView> {
    const party: CandidatureParty = { side: 'workspace', actor, workspaceId }
    // Nothing is told to whoever may not reach the candidature; then its row is locked and the
    // access read again after the lock.
    await this.candidatures.reachAs(party, candidatureId)
    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const candidature = await this.candidatures.lockAs(tx, party, candidatureId)
        const step = await tx.supportStep.findFirst({
          where: { id: stepId, workspaceId: candidature.workspaceId },
        })
        if (!step) throw SupportPathErrors.stepNotFound()
        if (!step.active) throw SupportPathErrors.stepInactive(step.label)
        const current = await tx.candidatureStepValidation.findFirst({
          where: { candidatureId: candidature.id, stepId: step.id },
        })
        const version = current?.version ?? 0
        if (version !== input.version) throw SupportPathErrors.changed(version)
        if ((current?.validatedAt != null) === input.validated) {
          return { candidature, step, change: null, version }
        }
        const changedAt = new Date()
        const data = input.validated
          ? { validatedAt: changedAt, validatedById: actor.id }
          : { validatedAt: null, validatedById: null }
        const row = current
          ? await tx.candidatureStepValidation.update({
              where: { id: current.id },
              data: { ...data, version: current.version + 1 },
            })
          : await tx.candidatureStepValidation.create({
              data: {
                candidatureId: candidature.id,
                workspaceId: candidature.workspaceId,
                stepId: step.id,
                ...data,
              },
            })
        const change: SupportStepChange = input.validated ? 'validated' : 'reopened'
        await tx.candidatureStepValidationChange.create({
          data: { validationId: row.id, change, actorId: actor.id, changedAt },
        })
        return { candidature, step, change, version: row.version }
      })
      .catch((err: unknown) => {
        // Two first validations at once: the unique index lets one through.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw SupportPathErrors.changed()
        }
        throw err
      })
    if (outcome.change) {
      await this.audit.record({
        actionType: 'candidature_support_step_updated',
        actorId: actor.id,
        dossierId: outcome.candidature.dossierId,
        metadata: {
          candidatureId: outcome.candidature.id,
          workspaceId: outcome.candidature.workspaceId,
          stepId: outcome.step.id,
          step: outcome.step.key,
          change: outcome.change,
          version: outcome.version,
        },
      })
    }
    return this.receivedView(outcome.candidature)
  }

  // The workspace's steps in the path's order with this candidature's validations: the active steps,
  // and the deactivated ones whose validation stands (a step the structure stopped using after
  // validating it); a deactivated step never validated, or reopened, is no longer part of the path.
  private async state(candidature: Candidature) {
    const [steps, validations] = await Promise.all([
      this.prisma.supportStep.findMany({
        where: { workspaceId: candidature.workspaceId },
        orderBy: STEP_ORDER,
      }),
      this.prisma.candidatureStepValidation.findMany({
        where: { candidatureId: candidature.id },
      }),
    ])
    const byStep = new Map(validations.map((v) => [v.stepId, v]))
    const shown = steps.filter((step) => step.active || byStep.get(step.id)?.validatedAt)
    return { steps, shown, byStep, validations }
  }

  private async receivedView(candidature: Candidature): Promise<ReceivedSupportPathView> {
    const { steps, shown, byStep, validations } = await this.state(candidature)
    const changes = await this.prisma.candidatureStepValidationChange.findMany({
      where: { validationId: { in: validations.map((v) => v.id) } },
      orderBy: { changedAt: 'desc' },
    })
    const people = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...validations.flatMap((v) => (v.validatedById ? [v.validatedById] : [])),
            ...changes.flatMap((c) => (c.actorId ? [c.actorId] : [])),
          ],
        },
      },
    })
    const personById = new Map(people.map((u) => [u.id, u]))
    const member = (id: string | null): MemberView | null => {
      const u = id ? personById.get(id) : undefined
      return u ? { email: u.email, firstName: u.firstName, lastName: u.lastName } : null
    }
    const stepById = new Map(steps.map((s) => [s.id, s]))
    const validationById = new Map(validations.map((v) => [v.id, v]))
    return {
      candidatureId: candidature.id,
      workspaceId: candidature.workspaceId,
      steps: shown.map((step) => {
        const validation = byStep.get(step.id)
        return {
          ...stepView(step, validation),
          validatedBy: validation?.validatedAt ? member(validation.validatedById) : null,
        }
      }),
      progress: progressOf(steps, byStep),
      history: changes.map((c) => {
        const step = stepById.get(validationById.get(c.validationId)!.stepId)!
        return {
          stepId: step.id,
          stepLabel: step.label,
          change: c.change === 'validated' ? 'validated' : 'reopened',
          changedAt: c.changedAt,
          actor: member(c.actorId),
        }
      }),
    }
  }
}

function stepView(
  step: SupportStep,
  validation: CandidatureStepValidation | undefined,
): SupportPathStepView {
  return {
    id: step.id,
    key: step.key,
    label: step.label,
    explanation: step.explanation,
    active: step.active,
    validatedAt: validation?.validatedAt ?? null,
    version: validation?.version ?? 0,
  }
}

// E06.07: the candidature's phase, by the shared rule, from every step of the workspace's path.
function progressOf(
  steps: SupportStep[],
  byStep: Map<string, CandidatureStepValidation>,
): SupportProgress {
  return supportProgress(
    steps.map((step) => ({ ...step, validatedAt: byStep.get(step.id)?.validatedAt ?? null })),
  )
}
