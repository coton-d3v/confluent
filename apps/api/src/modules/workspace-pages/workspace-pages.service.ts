import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma, Workspace } from '@prisma/client'
import {
  WORKSPACE_LOGO_MAX_BYTES,
  WORKSPACE_PAGE_LIMITS,
  toPublicCommittee,
  workspaceSlugSchema,
  type PublicWorkspace,
} from '@confluent/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { openCandidatureFormVersion } from '../candidatures/candidatures.service'
import { toView, type CommitteeView } from '../committees/committee-views'
import {
  STORAGE_TOKEN,
  StoredObjectMissingError,
  type StorageAdapter,
} from '../documents/storage/storage.adapter'
import { offeredCommittees } from '../participation-requests/participation-requests.service'
import { WorkspaceAccessService, type WorkspaceActor } from '../workspaces/workspace-access'
import { detectLogoType } from '../workspaces/workspace-logo'
import { lockWorkspaceRow } from '../workspaces/workspaces.service'
import { WorkspacePageErrors } from './workspace-page-errors'
import { toPublicWorkspace } from './workspace-page-views'

// The page settings as validated by @confluent/shared `updateWorkspacePageSchema`.
export interface WorkspacePageInput {
  published: boolean
  criteria: string | null
  contact: string | null
  version: number
}

// @confluent/shared `publicWorkspacePageSchema`.
export interface PublicWorkspacePageView {
  workspace: PublicWorkspace
  committees: Array<Pick<CommitteeView, 'id' | 'name' | 'date' | 'time' | 'timeZone' | 'startsAt'>>
  receivesCandidatures: boolean
}

// @confluent/shared `workspacePageSettingsSchema`.
export interface WorkspacePageSettingsView {
  published: boolean
  criteria: string | null
  contact: string | null
  version: number
  preview: PublicWorkspacePageView
}

const PAGE_FIELDS = {
  published: 'publicPagePublished',
  criteria: 'publicCriteria',
  contact: 'publicContact',
} as const

// A workspace's public page (ROADMAP E09.01, rules in @confluent/shared `workspace-page.schema.ts`).
//
// The public — no account, no session — reads a published page by the workspace's slug: its
// identity, presentation, criteria and contact (`toPublicWorkspace`, a closed list of columns), the
// next sessions offered on its participation form (E08.04, `toPublicCommittee`: name and when) and
// whether it receives candidatures (E05.09); its logo through a route of its own, never a bucket
// address. An unknown slug and an unpublished page answer the same `404` (R66). Nothing of its
// members, its internal settings or its committees' place, link, information or notes.
//
// Its managers (`canManageWorkspace`) read and write the page's settings — published or not,
// criteria, contact — under the workspace's lock, the right read again after it (R53), from the
// version they read (`409`, never reused: R63), journaled in the same transaction
// (`workspace_updated`, fields named, texts never copied). They read what the public sees, or would
// see once published, built by the same projection.
@Injectable()
export class WorkspacePagesService {
  private readonly logger = new Logger(WorkspacePagesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
  ) {}

  // ── The public ───────────────────────────────────────────────────────────────────────────────

  async publicPage(slug: string): Promise<PublicWorkspacePageView> {
    return this.pageOf(await this.published(slug), Date.now())
  }

  // The logo of a published page, read from the private bucket by the API, its format recognised
  // again from its content. A page without a logo, or whose image is lost, answers the page's `404`.
  async logo(slug: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const workspace = await this.published(slug)
    if (!workspace.logoKey) throw WorkspacePageErrors.notFound()
    let buffer: Buffer
    try {
      buffer = await this.storage.read(workspace.logoKey)
    } catch (err) {
      if (err instanceof StoredObjectMissingError) throw WorkspacePageErrors.notFound()
      this.logger.warn(`public logo storage unreachable: ${(err as Error).message}`)
      throw WorkspacePageErrors.logoUnavailable()
    }
    const type = buffer.byteLength <= WORKSPACE_LOGO_MAX_BYTES ? detectLogoType(buffer) : null
    if (!type) throw WorkspacePageErrors.notFound()
    return { buffer, mimetype: type.mimetype }
  }

  // ── Its managers ─────────────────────────────────────────────────────────────────────────────

  async settings(actor: WorkspaceActor, workspaceId: string): Promise<WorkspacePageSettingsView> {
    const { workspace } = await this.access.assertCanManage(actor, workspaceId)
    return this.settingsOf(workspace)
  }

  // Every setting again, from the version the client read. The same values write nothing (no new
  // version, no journal entry).
  async update(
    actor: WorkspaceActor,
    workspaceId: string,
    input: WorkspacePageInput,
  ): Promise<WorkspacePageSettingsView> {
    await this.access.assertCanManage(actor, workspaceId)
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockForManager(tx, actor, workspaceId)
      if (current.publicPageVersion !== input.version) {
        throw WorkspacePageErrors.changed(current.publicPageVersion)
      }
      const changes = (Object.keys(PAGE_FIELDS) as Array<keyof typeof PAGE_FIELDS>).filter(
        (field) => input[field] !== current[PAGE_FIELDS[field]],
      )
      if (changes.length === 0) return current
      const wasPublished = current.publicPagePublished
      const row = await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          publicPagePublished: input.published,
          publicCriteria: input.criteria,
          publicContact: input.contact,
          publicPageVersion: current.publicPageVersion + 1,
        },
      })
      await this.audit.recordIn(tx, {
        actionType: 'workspace_updated',
        actorId: actor.id,
        metadata: {
          workspaceId,
          // Named like the other settings' changes; the texts are never copied.
          changes: changes.map((field) => PAGE_FIELDS[field]),
          publicPageVersion: row.publicPageVersion,
          ...(changes.includes('published')
            ? {
                publicPagePublished: { from: wasPublished, to: row.publicPagePublished },
              }
            : {}),
        },
      })
      return row
    })
    return this.settingsOf(updated)
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  // The workspace of a slug, if its page is published; `404` alike otherwise.
  private async published(slug: string): Promise<Workspace> {
    if (!workspaceSlugSchema.safeParse(slug).success) throw WorkspacePageErrors.notFound()
    const workspace = await this.prisma.workspace.findUnique({ where: { slug } })
    if (!workspace || workspace.publicPagePublished !== true) throw WorkspacePageErrors.notFound()
    return workspace
  }

  private async pageOf(workspace: Workspace, now: number): Promise<PublicWorkspacePageView> {
    const [committees, candidatureForm] = await Promise.all([
      offeredCommittees(this.prisma, workspace.id, now),
      openCandidatureFormVersion(this.prisma, workspace.id),
    ])
    return {
      workspace: toPublicWorkspace(workspace),
      committees: committees
        .slice(0, WORKSPACE_PAGE_LIMITS.committees)
        .map((c) => toPublicCommittee(toView(c))),
      receivesCandidatures: candidatureForm !== null,
    }
  }

  private async settingsOf(workspace: Workspace): Promise<WorkspacePageSettingsView> {
    return {
      published: workspace.publicPagePublished,
      criteria: workspace.publicCriteria,
      contact: workspace.publicContact,
      version: workspace.publicPageVersion,
      preview: await this.pageOf(workspace, Date.now()),
    }
  }

  // The right is checked first (nothing is told to whoever may not manage), then read again once the
  // row is locked: a manager deactivated or deprived of the right while the request waited for the
  // lock writes nothing (R53). The page is read after the lock.
  private async lockForManager(
    tx: Prisma.TransactionClient,
    actor: WorkspaceActor,
    workspaceId: string,
  ): Promise<Workspace> {
    await lockWorkspaceRow(tx, workspaceId)
    return (await this.access.assertCanManage(actor, workspaceId, tx)).workspace
  }
}
