import { Injectable } from '@nestjs/common'
import { Prisma, type EligibilityScheme } from '@prisma/client'
import { ELIGIBILITY_SCHEME_LIMITS, canReviewCandidatures } from '@confluent/shared'
import { labelClash, listKey, namesWholeList, nextPosition } from '../../common/workspace-list'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { EligibilityErrors } from './eligibility-errors'

// @confluent/shared `eligibilitySchemeSchema`.
export interface EligibilitySchemeView {
  id: string
  key: string
  label: string
  description: string | null
  position: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export const SCHEME_ORDER = [{ position: 'asc' as const }, { key: 'asc' as const }]

// The schemes (« dispositifs ») a workspace records its candidatures' eligibility to (ROADMAP
// E06.05): information and filters, never a tax simulation. Read by those who read the workspace's
// candidatures — its active conseillers and Confluent administrators (`canReviewCandidatures`) —,
// configured by its managers (`canManageWorkspace`, through `WorkspaceAccessService`), each rule read
// at every request, closed by default. Every write locks the workspace row first and reads the list
// after the lock, so two managers never both take the same label or position. The list rules (key,
// label, position, reorder) are those of the funding source categories (`common/workspace-list`).
@Injectable()
export class EligibilitySchemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  // Every scheme, deactivated ones included, in the workspace's order.
  async list(actor: WorkspaceActor, workspaceId: string): Promise<EligibilitySchemeView[]> {
    const scope = await this.access.resolve(actor, workspaceId)
    if (!canReviewCandidatures(actor, scope.membership)) {
      throw EligibilityErrors.schemesReadForbidden()
    }
    const rows = await this.prisma.eligibilityScheme.findMany({
      where: { workspaceId },
      orderBy: SCHEME_ORDER,
    })
    return rows.map(toView)
  }

  // A scheme of the workspace's own, last in the list and active; its key is derived from the label
  // once (suffixed when already taken) and never changes afterwards.
  async create(
    actor: WorkspaceActor,
    workspaceId: string,
    input: { label: string; description?: string | null },
  ): Promise<EligibilitySchemeView> {
    await this.access.assertCanManage(actor, workspaceId)
    const created = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (current.length >= ELIGIBILITY_SCHEME_LIMITS.perWorkspace) {
        throw EligibilityErrors.tooManySchemes()
      }
      assertLabelFree(current, input.label, null)
      return tx.eligibilityScheme.create({
        data: {
          workspaceId,
          key: listKey(input.label, current, {
            maxLength: ELIGIBILITY_SCHEME_LIMITS.key,
            fallback: 'dispositif',
          }),
          label: input.label,
          description: input.description ?? null,
          position: nextPosition(current),
          active: true,
        },
      })
    }, input.label)
    await this.record(actor, workspaceId, {
      change: 'created',
      schemeId: created.id,
      key: created.key,
      label: created.label,
      description: created.description,
    })
    return toView(created)
  }

  // Renames, describes and/or (de)activates; what is sent unchanged changes nothing and is not
  // journaled. Deactivating every scheme is allowed: a workspace may not use them.
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    schemeId: string,
    input: { label?: string; description?: string | null; active?: boolean },
  ): Promise<EligibilitySchemeView> {
    await this.access.assertCanManage(actor, workspaceId)
    const { scheme, changes } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      const existing = current.find((s) => s.id === schemeId)
      if (!existing) throw EligibilityErrors.schemeNotFound()
      const data: { label?: string; description?: string | null; active?: boolean } = {}
      if (input.label !== undefined && input.label !== existing.label) {
        assertLabelFree(current, input.label, existing.id)
        data.label = input.label
      }
      if (input.description !== undefined && input.description !== existing.description) {
        data.description = input.description
      }
      if (input.active !== undefined && input.active !== existing.active) {
        data.active = input.active
      }
      const fields = Object.keys(data) as Array<keyof typeof data>
      if (fields.length === 0) return { scheme: existing, changes: [] }
      const updated = await tx.eligibilityScheme.update({ where: { id: existing.id }, data })
      return {
        scheme: updated,
        changes: fields.map((field) => ({ field, from: existing[field], to: updated[field] })),
      }
    }, input.label)
    if (changes.length > 0) {
      await this.record(actor, workspaceId, {
        change: 'updated',
        schemeId: scheme.id,
        key: scheme.key,
        changes,
      })
    }
    return toView(scheme)
  }

  // The whole list in a new order: exactly the workspace's schemes, each once, else the site works
  // from a stale list (`409`). Returns the list in its new order.
  async reorder(
    actor: WorkspaceActor,
    workspaceId: string,
    schemeIds: string[],
  ): Promise<EligibilitySchemeView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    const { rows, moved } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (!namesWholeList(current, schemeIds)) throw EligibilityErrors.schemeOrderStale()
      let moved = false
      for (const [position, id] of schemeIds.entries()) {
        if (current.find((s) => s.id === id)!.position === position) continue
        await tx.eligibilityScheme.update({ where: { id }, data: { position } })
        moved = true
      }
      const rows = await tx.eligibilityScheme.findMany({
        where: { workspaceId },
        orderBy: SCHEME_ORDER,
      })
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
  ): Promise<EligibilityScheme[]> {
    await lockWorkspaceRow(tx, workspaceId)
    await this.access.assertCanManage(actor, workspaceId, tx)
    return tx.eligibilityScheme.findMany({ where: { workspaceId }, orderBy: SCHEME_ORDER })
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
      if (unique && label !== undefined) throw EligibilityErrors.schemeLabelTaken(label)
      throw err
    }
  }

  private record(actor: WorkspaceActor, workspaceId: string, details: Record<string, unknown>) {
    return this.audit.record({
      actionType: 'eligibility_schemes_updated',
      actorId: actor.id,
      metadata: { workspaceId, ...details },
    })
  }
}

function assertLabelFree(schemes: EligibilityScheme[], label: string, exceptId: string | null) {
  const clash = labelClash(schemes, label, exceptId)
  if (clash) throw EligibilityErrors.schemeLabelTaken(clash.label)
}

function toView(row: EligibilityScheme): EligibilitySchemeView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    position: row.position,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
