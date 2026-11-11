import { Injectable } from '@nestjs/common'
import { Prisma, type FundingSourceCategory } from '@prisma/client'
import {
  FUNDING_SOURCE_CATEGORY_LIMITS,
  canReviewCandidatures,
  fundingSourceFamilyOf,
  type FundingSourceFamily,
} from '@confluent/shared'
import { slugify } from '../../common/slug'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { FundingSourceErrors } from './funding-source-errors'

export interface FundingSourceCategoryView {
  id: string
  key: string
  label: string
  family: FundingSourceFamily
  position: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const ORDER = [{ position: 'asc' as const }, { key: 'asc' as const }]

// The categories of sources a workspace splits financing plans into (ROADMAP E06.02, decision D04
// still to be confirmed). Read by those who read the workspace's candidatures — its active
// conseillers and Confluent administrators (`canReviewCandidatures`): E06.03 shows a candidature's
// plan with them —, configured by its managers (`canManageWorkspace`, through
// `WorkspaceAccessService`), each rule read at every request, closed by default. Every write locks
// the workspace row first and reads the list after the lock, so two managers never both take the
// last active category, the same label or the same position.
@Injectable()
export class FundingSourceCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  // Every category, deactivated ones included, in the workspace's order.
  async list(actor: WorkspaceActor, workspaceId: string): Promise<FundingSourceCategoryView[]> {
    const scope = await this.access.resolve(actor, workspaceId)
    if (!canReviewCandidatures(actor, scope.membership)) throw FundingSourceErrors.readForbidden()
    const rows = await this.prisma.fundingSourceCategory.findMany({
      where: { workspaceId },
      orderBy: ORDER,
    })
    return rows.map(toView)
  }

  // A category of the workspace's own, last in the list and active; its key is derived from the
  // label once (suffixed when already taken), its family chosen now — neither changes afterwards.
  async create(
    actor: WorkspaceActor,
    workspaceId: string,
    input: { label: string; family: FundingSourceFamily },
  ): Promise<FundingSourceCategoryView> {
    await this.access.assertCanManage(actor, workspaceId)
    const created = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (current.length >= FUNDING_SOURCE_CATEGORY_LIMITS.perWorkspace) {
        throw FundingSourceErrors.tooMany()
      }
      assertLabelFree(current, input.label, null)
      return tx.fundingSourceCategory.create({
        data: {
          workspaceId,
          key: uniqueKey(input.label, current),
          label: input.label,
          family: input.family,
          position: current.reduce((max, c) => Math.max(max, c.position + 1), 0),
          active: true,
        },
      })
    }, input.label)
    await this.record(actor, workspaceId, {
      change: 'created',
      categoryId: created.id,
      key: created.key,
      label: created.label,
      family: created.family,
    })
    return toView(created)
  }

  // Renames and/or (de)activates; what is sent unchanged changes nothing and is not journaled. The
  // workspace keeps at least one active category, which a plan can be entered against.
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    categoryId: string,
    input: { label?: string; active?: boolean },
  ): Promise<FundingSourceCategoryView> {
    await this.access.assertCanManage(actor, workspaceId)
    const { category, changes } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      const existing = current.find((c) => c.id === categoryId)
      if (!existing) throw FundingSourceErrors.notFound()
      const data: { label?: string; active?: boolean } = {}
      if (input.label !== undefined && input.label !== existing.label) {
        assertLabelFree(current, input.label, existing.id)
        data.label = input.label
      }
      if (input.active !== undefined && input.active !== existing.active) {
        if (!input.active && !current.some((c) => c.active && c.id !== existing.id)) {
          throw FundingSourceErrors.lastActive()
        }
        data.active = input.active
      }
      const changed = Object.keys(data)
      if (changed.length === 0) return { category: existing, changes: [] }
      const updated = await tx.fundingSourceCategory.update({ where: { id: existing.id }, data })
      return {
        category: updated,
        changes: changed.map((field) =>
          field === 'label'
            ? { field, from: existing.label, to: updated.label }
            : { field, from: existing.active, to: updated.active },
        ),
      }
    }, input.label)
    if (changes.length > 0) {
      await this.record(actor, workspaceId, {
        change: 'updated',
        categoryId: category.id,
        key: category.key,
        changes,
      })
    }
    return toView(category)
  }

  // The whole list in a new order: exactly the workspace's categories, each once, else the site
  // works from a stale list (`409`). Returns the list in its new order.
  async reorder(
    actor: WorkspaceActor,
    workspaceId: string,
    categoryIds: string[],
  ): Promise<FundingSourceCategoryView[]> {
    await this.access.assertCanManage(actor, workspaceId)
    const { rows, moved } = await this.write(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      const known = new Set(current.map((c) => c.id))
      if (
        categoryIds.length !== current.length ||
        new Set(categoryIds).size !== categoryIds.length ||
        !categoryIds.every((id) => known.has(id))
      ) {
        throw FundingSourceErrors.orderStale()
      }
      let moved = false
      for (const [position, id] of categoryIds.entries()) {
        if (current.find((c) => c.id === id)!.position === position) continue
        await tx.fundingSourceCategory.update({ where: { id }, data: { position } })
        moved = true
      }
      const rows = await tx.fundingSourceCategory.findMany({
        where: { workspaceId },
        orderBy: ORDER,
      })
      return { rows, moved }
    })
    if (moved) {
      await this.record(actor, workspaceId, {
        change: 'reordered',
        keys: rows.map((c) => c.key),
      })
    }
    return rows.map(toView)
  }

  // The right is checked first (nothing is told to whoever may not manage), then read again once the
  // workspace row is locked (a manager deprived of the right while waiting writes nothing); the
  // list is read after the lock.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<FundingSourceCategory[]> {
    await lockWorkspaceRow(tx, workspaceId)
    await this.access.assertCanManage(actor, workspaceId, tx)
    return tx.fundingSourceCategory.findMany({ where: { workspaceId }, orderBy: ORDER })
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
      if (unique && label !== undefined) throw FundingSourceErrors.labelTaken(label)
      throw err
    }
  }

  private record(actor: WorkspaceActor, workspaceId: string, details: Record<string, unknown>) {
    return this.audit.record({
      actionType: 'funding_source_categories_updated',
      actorId: actor.id,
      metadata: { workspaceId, ...details },
    })
  }
}

// Labels are told apart without regard to case: « Prêt bancaire » and « prêt bancaire » would read
// as the same source in a plan.
function assertLabelFree(
  categories: FundingSourceCategory[],
  label: string,
  exceptId: string | null,
): void {
  const wanted = label.toLocaleLowerCase('fr')
  const clash = categories.find(
    (c) => c.id !== exceptId && c.label.toLocaleLowerCase('fr') === wanted,
  )
  if (clash) throw FundingSourceErrors.labelTaken(clash.label)
}

// `snake_case` ASCII from the label (`source` when nothing is left), unique in the workspace.
export function uniqueKey(label: string, categories: Array<{ key: string }>): string {
  const room = FUNDING_SOURCE_CATEGORY_LIMITS.key - 4
  const base =
    slugify(label, 'source').replace(/-/g, '_').slice(0, room).replace(/_+$/, '') || 'source'
  const taken = new Set(categories.map((c) => c.key))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

function toView(row: FundingSourceCategory): FundingSourceCategoryView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    family: fundingSourceFamilyOf(row.family),
    position: row.position,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
