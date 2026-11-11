import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma, type Workspace } from '@prisma/client'
import {
  WORKSPACE_LIMITS,
  WORKSPACE_LOGO_MAX_BYTES,
  workspaceSlugSchema,
  type DocumentAvailability,
  type InvestorType,
  type WorkspaceMemberRole,
} from '@confluent/shared'
import { slugify } from '../../common/slug'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { createDefaultEligibilitySchemes } from '../eligibilities/eligibility-scheme-defaults'
import { createDefaultSupportSteps } from '../support-paths/support-step-defaults'
import { createDefaultFundingSourceCategories } from '../funding-sources/funding-source-defaults'
import {
  MAX_SIGNED_URL_SECONDS,
  STORAGE_TOKEN,
  StorageQuotaExceededError,
  StoredObjectMissingError,
  type StorageAdapter,
} from '../documents/storage/storage.adapter'
import {
  WorkspaceAccessService,
  assertCanAdministerAllWorkspaces,
  canAdministerAllWorkspaces,
  canManageWorkspace,
  type WorkspaceActor,
} from './workspace-access'
import { WorkspaceErrors } from './workspace-errors'
import { detectLogoType } from './workspace-logo'

// Settings as validated by createWorkspaceSchema / updateWorkspaceSchema (null clears a setting).
export interface WorkspaceSettings {
  name: string
  programName?: string | null
  color?: string | null
  presentation?: string | null
  contactEmail?: string | null
  emailDomain?: string | null
}

export interface WorkspaceView {
  id: string
  slug: string
  name: string
  programName: string | null
  color: string | null
  presentation: string | null
  contactEmail: string | null
  emailDomain: string | null
  logo: { availability: DocumentAvailability; url: string | null } | null
  createdAt: Date
  updatedAt: Date
}

// A workspace as one of its members sees it, with their membership (null for an administrator who
// is not a member).
export interface CurrentWorkspaceView {
  workspace: Omit<WorkspaceView, 'emailDomain' | 'createdAt' | 'updatedAt'>
  membership: {
    id: string
    role: WorkspaceMemberRole
    organization: string | null
    investorType: InvestorType | null
    canManageWorkspace: boolean
  } | null
  canManageWorkspace: boolean
}

const SETTING_KEYS = [
  'name',
  'programName',
  'color',
  'presentation',
  'contactEmail',
  'emailDomain',
] as const

// Workspaces and their settings (ROADMAP E05.01). Every read and write checks who acts first,
// whatever the caller: creating and listing all workspaces is for administrators, setting up one
// follows the single management rule (administrators and the workspace's managers, E05.02).
// Who may enter a workspace at all is resolved first, at each call (E05.03, `WorkspaceAccessService`).
@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(actor: WorkspaceActor): Promise<WorkspaceView[]> {
    assertCanAdministerAllWorkspaces(actor)
    const rows = await this.prisma.workspace.findMany({ orderBy: { name: 'asc' } })
    return Promise.all(rows.map((row) => this.toView(row)))
  }

  async get(actor: WorkspaceActor, workspaceId: string): Promise<WorkspaceView> {
    const { workspace } = await this.access.assertCanManage(actor, workspaceId)
    return this.toView(workspace)
  }

  // Entering a workspace (E05.03): what any of its active members — or an administrator — sees of
  // it, with their own membership and whether they manage it. The email domain is a management
  // setting, left out.
  async enter(actor: WorkspaceActor, workspaceId: string): Promise<CurrentWorkspaceView> {
    const { workspace, membership } = await this.access.resolve(actor, workspaceId)
    const view = await this.toView(workspace)
    return {
      workspace: {
        id: view.id,
        slug: view.slug,
        name: view.name,
        programName: view.programName,
        color: view.color,
        presentation: view.presentation,
        contactEmail: view.contactEmail,
        logo: view.logo,
      },
      membership: membership && {
        id: membership.id,
        role: membership.role as WorkspaceMemberRole,
        organization: membership.organization,
        investorType: membership.investorType as InvestorType | null,
        canManageWorkspace: membership.canManageWorkspace,
      },
      canManageWorkspace: canManageWorkspace(actor, membership),
    }
  }

  // The slug is chosen once: derived from the name when not given, refused when already taken
  // (never suffixed behind the administrator's back: it becomes a public address).
  async create(
    actor: WorkspaceActor,
    input: WorkspaceSettings & { slug?: string },
  ): Promise<WorkspaceView> {
    assertCanAdministerAllWorkspaces(actor)
    const slug = input.slug ?? derivedSlug(input.name)
    if (!workspaceSlugSchema.safeParse(slug).success) throw WorkspaceErrors.slugRequired()
    if (await this.prisma.workspace.findUnique({ where: { slug } })) {
      throw WorkspaceErrors.slugTaken(slug)
    }
    let created: Workspace
    try {
      // With D04's default funding source categories (E06.02), the default eligibility schemes
      // (E06.05) and the default support path (E06.06), in the same transaction.
      created = await this.prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: {
            slug,
            name: input.name,
            programName: input.programName ?? null,
            color: input.color ?? null,
            presentation: input.presentation ?? null,
            contactEmail: input.contactEmail ?? null,
            emailDomain: input.emailDomain ?? null,
          },
        })
        await createDefaultFundingSourceCategories(tx, workspace.id)
        await createDefaultEligibilitySchemes(tx, workspace.id)
        await createDefaultSupportSteps(tx, workspace.id)
        return workspace
      })
    } catch (err) {
      // Two creations with the same slug at once: the unique index decides.
      if (isUniqueViolation(err)) throw WorkspaceErrors.slugTaken(slug)
      throw err
    }
    await this.audit.record({
      actionType: 'workspace_created',
      actorId: actor.id,
      metadata: { workspaceId: created.id, slug, name: created.name },
    })
    return this.toView(created)
  }

  // Only the settings present in `input` change; the slug never does. A manager cannot change the
  // email domain: it bounds whom the managers themselves may invite.
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    input: Partial<WorkspaceSettings>,
  ): Promise<WorkspaceView> {
    await this.access.assertCanManage(actor, workspaceId)
    const { updated, changes } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      const data: Partial<WorkspaceSettings> = {}
      for (const key of SETTING_KEYS) {
        const value = input[key]
        if (value !== undefined && value !== current[key]) Object.assign(data, { [key]: value })
      }
      if (data.emailDomain !== undefined && !canAdministerAllWorkspaces(actor)) {
        throw WorkspaceErrors.emailDomainReserved()
      }
      const changed = Object.keys(data)
      if (changed.length === 0) return { updated: current, changes: changed }
      return {
        updated: await tx.workspace.update({ where: { id: workspaceId }, data }),
        changes: changed,
      }
    })
    if (changes.length > 0) {
      await this.audit.record({
        actionType: 'workspace_updated',
        actorId: actor.id,
        metadata: { workspaceId, changes },
      })
    }
    return this.toView(updated)
  }

  // The image is checked from its content, stored under a new opaque key, then the row points to it;
  // the previous image is deleted only once the new one is recorded.
  async setLogo(
    actor: WorkspaceActor,
    workspaceId: string,
    buffer: Buffer | undefined,
  ): Promise<WorkspaceView> {
    await this.access.assertCanManage(actor, workspaceId)
    if (!buffer || buffer.byteLength === 0) throw WorkspaceErrors.logoRequired()
    // Normally enforced earlier by the size guard and the multipart limit.
    if (buffer.byteLength > WORKSPACE_LOGO_MAX_BYTES) throw WorkspaceErrors.logoTooLarge()
    const type = detectLogoType(buffer)
    if (!type) throw WorkspaceErrors.logoType()
    const key = `workspaces/${workspaceId}/logo/${randomUUID()}.${type.extension}`
    await this.store(key, buffer, type.mimetype)
    let replaced: { updated: Workspace; previousKey: string | null }
    try {
      replaced = await this.prisma.$transaction(async (tx) => {
        const current = await this.lockForManager(tx, actor, workspaceId)
        const updated = await tx.workspace.update({
          where: { id: workspaceId },
          data: { logoKey: key },
        })
        return { updated, previousKey: current.logoKey }
      })
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined)
      throw err
    }
    await this.deleteObject(replaced.previousKey)
    await this.audit.record({
      actionType: 'workspace_updated',
      actorId: actor.id,
      metadata: { workspaceId, changes: ['logo'] },
    })
    return this.toView(replaced.updated)
  }

  async removeLogo(actor: WorkspaceActor, workspaceId: string): Promise<WorkspaceView> {
    await this.access.assertCanManage(actor, workspaceId)
    const { updated, previousKey } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (!current.logoKey) return { updated: current, previousKey: null }
      return {
        updated: await tx.workspace.update({ where: { id: workspaceId }, data: { logoKey: null } }),
        previousKey: current.logoKey,
      }
    })
    if (previousKey) {
      await this.deleteObject(previousKey)
      await this.audit.record({
        actionType: 'workspace_updated',
        actorId: actor.id,
        metadata: { workspaceId, changes: ['logo_removed'] },
      })
    }
    return this.toView(updated)
  }

  // The right is checked first (nothing is told to whoever may not manage), then read again once the
  // row is locked: a manager deactivated or deprived of the right while the request waited for the
  // lock writes nothing (code review R53), as for the members.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<Workspace> {
    const current = await lockWorkspace(tx, workspaceId)
    await this.access.assertCanManage(actor, workspaceId, tx)
    return current
  }

  private async toView(row: Workspace): Promise<WorkspaceView> {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      programName: row.programName,
      color: row.color,
      presentation: row.presentation,
      contactEmail: row.contactEmail,
      emailDomain: row.emailDomain,
      logo: row.logoKey ? await this.logoLink(row.logoKey) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  // Same private bucket and signed URLs (15 min) as documents: no permanent public address.
  private async logoLink(key: string): Promise<NonNullable<WorkspaceView['logo']>> {
    try {
      const url = await this.storage.getSignedUrl(key, {
        filename: `logo${key.slice(key.lastIndexOf('.'))}`,
        ttlSeconds: MAX_SIGNED_URL_SECONDS,
      })
      return { availability: 'available', url }
    } catch (err) {
      if (err instanceof StoredObjectMissingError) {
        this.logger.warn(`workspace logo missing: ${key}`)
        return { availability: 'missing', url: null }
      }
      this.logger.warn(`workspace logo storage unreachable for ${key}: ${(err as Error).message}`)
      return { availability: 'unavailable', url: null }
    }
  }

  private async store(key: string, buffer: Buffer, mimetype: string): Promise<void> {
    try {
      await this.storage.upload(key, buffer, mimetype)
    } catch (err) {
      if (err instanceof StorageQuotaExceededError) {
        this.logger.error('storage quota reached: workspace logo refused')
        throw WorkspaceErrors.storageFull()
      }
      this.logger.error(
        `workspace logo upload failed: ${(err as Error).name} ${(err as Error).message}`,
      )
      throw WorkspaceErrors.storageUnavailable()
    }
  }

  // The row no longer points to it: a failure only leaves an unreachable object behind.
  private async deleteObject(key: string | null): Promise<void> {
    if (!key) return
    await this.storage.delete(key).catch((err: Error) => {
      this.logger.warn(`previous workspace logo not deleted (${key}): ${err.message}`)
    })
  }
}

function derivedSlug(name: string): string {
  return slugify(name, '').slice(0, WORKSPACE_LIMITS.slugMax).replace(/-+$/, '')
}

// Every write to a workspace — its settings, logo or members — starts with this lock, inside its
// transaction, and reads the state only afterwards: two logo replacements cannot both keep (or both
// delete) the same previous image, two managers cannot both give up the last management right.
export async function lockWorkspaceRow(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE`
}

async function lockWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<Workspace> {
  await lockWorkspaceRow(tx, workspaceId)
  const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace) throw WorkspaceErrors.notFound()
  return workspace
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
