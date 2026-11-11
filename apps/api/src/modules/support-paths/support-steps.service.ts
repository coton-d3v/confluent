import { Injectable } from '@nestjs/common'
import { Prisma, type SupportStep } from '@prisma/client'
import { SUPPORT_STEP_LIMITS, canReviewCandidatures } from '@confluent/shared'
import { labelClash, listKey, namesWholeList, nextPosition } from '../../common/workspace-list'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { SupportPathErrors } from './support-path-errors'

// @confluent/shared `supportStepSchema`.
export interface SupportStepView {
  id: string
  key: string
  label: string
  explanation: string | null
  position: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export const STEP_ORDER = [{ position: 'asc' as const }, { key: 'asc' as const }]

// The steps of a workspace's support path (ROADMAP E06.06), with the explanation its entrepreneurs
// read. Read by those who follow the workspace's candidatures — its active conseillers and Confluent
// administrators (`canReviewCandidatures`) —, configured by its managers (`canManageWorkspace`,
// through `WorkspaceAccessService`), each rule read at every request, closed by default. Every write
// locks the workspace row first and reads the list after the lock, so two managers never both take
// the same label or position. The list rules (key, label, position, reorder) are those of the
// funding source categories and schemes (`common/workspace-list`). A step is never deleted: its
// validations refer to it; deactivated, it leaves the path and its validations stay, frozen.
@Injectable()
export class SupportStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  // Every step, deactivated ones included, in the path's order.
  async list(actor: WorkspaceActor, workspaceId: string): Promise<SupportStepView[]> {
    const scope = await this.access.resolve(actor, workspaceId)
    if (!canReviewCandidatures(actor, scope.membership)) {
      throw SupportPathErrors.stepsReadForbidden()
    }
    const rows = await this.prisma.supportStep.findMany({
      where: { workspaceId },
      orderBy: STEP_ORDER,
    })
    return rows.map(toView)
  }

  // A step of the workspace's own, last in the path and active; its key is derived from the label
  // once (suffixed when already taken) and never changes afterwards.
  async create(
    actor: WorkspaceActor,
    workspaceId: string,
    input: { label: string; explanation?: string | null },
  ): Promise<SupportStepView> {
    await this.access.assertCanManage(actor, workspaceId)
    const created = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (current.length >= SUPPORT_STEP_LIMITS.perWorkspace) throw SupportPathErrors.tooManySteps()
      assertLabelFree(current, input.label, null)
      return tx.supportStep.create({
        data: {
          workspaceId,
          key: listKey(input.label, current, {
            maxLength: SUPPORT_STEP_LIMITS.key,
            fallback: 'etape',
          }),
          label: input.label,
          explanation: input.explanation ?? null,
          position: nextPosition(current),
          active: true,
        },
      })
    }, input.label)
    await this.record(actor, workspaceId, {
      change: 'created',
      stepId: created.id,
      key: created.key,
      label: created.label,
      explanation: created.explanation,
    })
    return toView(created)
  }

  // Renames, explains and/or (de)activates; what is sent unchanged changes nothing and is not
  // journaled. A renamed step keeps its validations (the same step); deactivating every step is
  // allowed: a workspace may not follow its candidatures through a path.
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    stepId: string,
    input: { label?: string; explanation?: string | null; active?: boolean },
  ): Promise<SupportStepView> {
    await this.access.assertCanManage(actor, workspaceId)
    const { step, changes } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      const existing = current.find((s) => s.id === stepId)
      if (!existing) throw SupportPathErrors.stepNotFound()
      const data: { label?: string; explanation?: string | null; active?: boolean } = {}
      if (input.label !== undefined && input.label !== existing.label) {
        assertLabelFree(current, input.label, existing.id)
        data.label = input.label
      }
      if (input.explanation !== undefined && input.explanation !== existing.explanation) {
        data.explanation = input.explanation
      }
      if (input.active !== undefined && input.active !== existing.active) {
        data.active = input.active
      }
      const fields = Object.keys(data) as Array<keyof typeof data>
      if (fields.length === 0) return { step: existing, changes: [] }
      const updated = await tx.supportStep.update({ where: { id: existing.id }, data })
      return {
        step: updated,
        changes: fields.map((field) => ({ field, from: existing[field], to: updated[field] })),
      }
    }, input.label)
    if (changes.length > 0) {
      await this.record(actor, workspaceId, {
        change: 'updated',
        stepId: step.id,
        key: step.key,
        changes,
      })
    }
    return toView(step)
  }

  // The whole path in a new order: exactly the workspace's steps, each once, else the site works
  // from a stale list (`409`). Validations follow their step. Returns the path in its new order.
  async reorder(
    actor: WorkspaceActor,
    workspaceId: string,
    stepIds: string[],
  ): Promise<SupportStepView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    const { rows, moved } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (!namesWholeList(current, stepIds)) throw SupportPathErrors.stepOrderStale()
      let moved = false
      for (const [position, id] of stepIds.entries()) {
        if (current.find((s) => s.id === id)!.position === position) continue
        await tx.supportStep.update({ where: { id }, data: { position } })
        moved = true
      }
      const rows = await tx.supportStep.findMany({ where: { workspaceId }, orderBy: STEP_ORDER })
      return { rows, moved }
    })
    if (moved) {
      await this.record(actor, workspaceId, { change: 'reordered', keys: rows.map((s) => s.key) })
    }
    return rows.map(toView)
  }

  // The right is checked first (nothing is told to whoever may not manage), then read again once the
  // workspace row is locked (a manager deprived of the right while waiting writes nothing); the list
  // is read after the lock.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<SupportStep[]> {
    await lockWorkspaceRow(tx, workspaceId)
    await this.access.assertCanManage(actor, workspaceId, tx)
    return tx.supportStep.findMany({ where: { workspaceId }, orderBy: STEP_ORDER })
  }

  // The unique indexes back the label check made under the lock (against a write from elsewhere).
  private async write<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    label?: string,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(fn)
    } catch (err) {
      const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (unique && label !== undefined) throw SupportPathErrors.stepLabelTaken(label)
      throw err
    }
  }

  private record(actor: WorkspaceActor, workspaceId: string, details: Record<string, unknown>) {
    return this.audit.record({
      actionType: 'support_steps_updated',
      actorId: actor.id,
      metadata: { workspaceId, ...details },
    })
  }
}

function assertLabelFree(steps: SupportStep[], label: string, exceptId: string | null) {
  const clash = labelClash(steps, label, exceptId)
  if (clash) throw SupportPathErrors.stepLabelTaken(clash.label)
}

function toView(row: SupportStep): SupportStepView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    explanation: row.explanation,
    position: row.position,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
