import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma, Workspace } from '@prisma/client'
import {
  PUBLIC_PAGE_BLOCKS,
  WORKSPACE_LOGO_MAX_BYTES,
  WORKSPACE_PAGE_LIMITS,
  readPublicPageBlocks,
  toPublicCommittee,
  toPublicWorkspacePage,
  workspaceSlugSchema,
  type PublicPageBlock,
  type PublicPageContent,
  type PublicWorkspacePage,
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
import { ShowcaseCardsService } from '../showcase-cards/showcase-cards.service'
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
  // Absent: kept as they are.
  blocks?: PublicPageBlock[]
  // E09.06. Absent: kept as it is.
  indexable?: boolean
  version: number
}

// @confluent/shared `publicCommitteeSchema`, before its dates are sent.
type PublicCommitteeView = Pick<
  CommitteeView,
  'id' | 'name' | 'date' | 'time' | 'timeZone' | 'startsAt'
>

// @confluent/shared `publicPageContentSchema`.
export type PublicPageContentView = Omit<PublicPageContent, 'committees'> & {
  committees: PublicCommitteeView[]
}

// @confluent/shared `publicWorkspacePageSchema`.
export type PublicWorkspacePageView = Omit<PublicWorkspacePage, 'committees'> & {
  committees: PublicCommitteeView[]
}

// @confluent/shared `workspacePageSettingsSchema`.
export interface WorkspacePageSettingsView {
  published: boolean
  criteria: string | null
  contact: string | null
  blocks: PublicPageBlock[]
  indexable: boolean
  version: number
  preview: PublicWorkspacePageView
  content: PublicPageContentView
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
// members, its internal settings or its committees' place, link, information or notes. E09.02: the
// anonymous cards its candidates consented to show there (`ShowcaseCardsService.publicCards`).
// E09.04: all of it in blocks its managers show or not, in their order, through one projection
// (@confluent/shared `toPublicWorkspacePage`): a block not shown sends nothing, its data not even
// read. E09.06: and whether search engines may index it — only if its managers allowed it.
//
// Its managers (`canManageWorkspace`) read and write the page's settings — published or not,
// criteria, contact, blocks, indexing — under the workspace's lock, the right read again after it (R53), from
// the version they read (`409`, never reused: R63), journaled in the same transaction
// (`workspace_updated`, fields named, texts never copied). They read what the public sees, or would
// see once published, built by the same projection, and what every block may show (`content`) for
// the site to preview settings not yet saved through that projection.
@Injectable()
export class WorkspacePagesService {
  private readonly logger = new Logger(WorkspacePagesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageAdapter,
    private readonly cards: ShowcaseCardsService,
  ) {}

  // ── The public ───────────────────────────────────────────────────────────────────────────────

  async publicPage(slug: string): Promise<PublicWorkspacePageView> {
    const workspace = await this.published(slug)
    const blocks = readPublicPageBlocks(workspace.publicPageBlocks)
    return toPublicWorkspacePage(
      await this.contentOf(workspace, Date.now(), blocks),
      blocks,
      workspace.publicPageIndexable,
    )
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
      const changes: string[] = (Object.keys(PAGE_FIELDS) as Array<keyof typeof PAGE_FIELDS>)
        .filter((field) => input[field] !== current[PAGE_FIELDS[field]])
        .map((field) => PAGE_FIELDS[field])
      // Compared with the blocks as read (closed): a value no longer known is not a difference.
      const blocksBefore = readPublicPageBlocks(current.publicPageBlocks)
      const blocksAfter = input.blocks ?? blocksBefore
      const blocksChanged = blocksAfter.join() !== blocksBefore.join()
      if (blocksChanged) changes.push('publicPageBlocks')
      const indexableBefore = current.publicPageIndexable
      const indexable = input.indexable ?? indexableBefore
      const indexableChanged = indexable !== indexableBefore
      if (indexableChanged) changes.push('publicPageIndexable')
      if (changes.length === 0) return current
      const wasPublished = current.publicPagePublished
      const row = await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          publicPagePublished: input.published,
          publicCriteria: input.criteria,
          publicContact: input.contact,
          ...(blocksChanged ? { publicPageBlocks: blocksAfter } : {}),
          publicPageIndexable: indexable,
          publicPageVersion: current.publicPageVersion + 1,
        },
      })
      await this.audit.recordIn(tx, {
        actionType: 'workspace_updated',
        actorId: actor.id,
        metadata: {
          workspaceId,
          // Named like the other settings' changes; the texts are never copied.
          changes,
          publicPageVersion: row.publicPageVersion,
          ...(changes.includes('publicPagePublished')
            ? {
                publicPagePublished: { from: wasPublished, to: row.publicPagePublished },
              }
            : {}),
          // The blocks' names only, in their order.
          ...(blocksChanged ? { publicPageBlocks: { from: blocksBefore, to: blocksAfter } } : {}),
          ...(indexableChanged
            ? { publicPageIndexable: { from: indexableBefore, to: indexable } }
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

  // What the blocks may show, each by its closed projection; only what the blocks named need is read
  // (the sessions serve both `committees` and `participate`).
  private async contentOf(
    workspace: Workspace,
    now: number,
    blocks: readonly PublicPageBlock[],
  ): Promise<PublicPageContentView> {
    const needs = (...names: PublicPageBlock[]) => names.some((name) => blocks.includes(name))
    const [committees, candidatureForm, cards] = await Promise.all([
      needs('committees', 'participate') ? offeredCommittees(this.prisma, workspace.id, now) : [],
      needs('apply') ? openCandidatureFormVersion(this.prisma, workspace.id) : null,
      needs('cards') ? this.cards.publicCards(workspace, now) : [],
    ])
    return {
      workspace: toPublicWorkspace(workspace),
      committees: committees
        .slice(0, WORKSPACE_PAGE_LIMITS.committees)
        .map((c) => toPublicCommittee(toView(c))),
      receivesCandidatures: candidatureForm !== null,
      cards,
    }
  }

  private async settingsOf(workspace: Workspace): Promise<WorkspacePageSettingsView> {
    const blocks = readPublicPageBlocks(workspace.publicPageBlocks)
    // Every block's content, for a preview of other blocks than those saved.
    const content = await this.contentOf(workspace, Date.now(), PUBLIC_PAGE_BLOCKS)
    return {
      published: workspace.publicPagePublished,
      criteria: workspace.publicCriteria,
      contact: workspace.publicContact,
      blocks,
      indexable: workspace.publicPageIndexable,
      version: workspace.publicPageVersion,
      // What the public would see once published, indexing included.
      preview: toPublicWorkspacePage(content, blocks, workspace.publicPageIndexable),
      content,
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
