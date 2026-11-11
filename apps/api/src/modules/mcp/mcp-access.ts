import { HttpException, Injectable, NotFoundException } from '@nestjs/common'
import type { Dossier } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { WorkspaceAccessService, type WorkspaceScope } from '../workspaces/workspace-access'
import type { McpCaller } from './mcp.tools'
import { ToolError, UUID, type ToolTrace } from './tool-kit'

// The same answer for a workspace that does not exist, one the account is not an active member of,
// and one the person did not allow this application to reach: its existence is never told.
export const WORKSPACE_NOT_FOUND =
  'Workspace introuvable, ou non autorisé pour cette application. Utilisez list_workspaces.'

// What the MCP tools reach, on top of the services' own rules (ROADMAP E05.10): the connection
// reaches a workspace only if the person allowed it at consent time (`caller.workspaceIds`, the
// grant's, never widened by a refresh) AND the account may still enter it now — the workspaces'
// single access rule, `WorkspaceAccessService.resolve`, read at each call: a deactivated membership
// cuts the access even if it was allowed. Both are required; neither is decided here twice.
//
// Content outside any workspace — the account's own companies and dossiers, the dossiers shared
// with a financeur, the candidatures an entrepreneur presents — is the person's own: it is reached
// as before, by the services' rules. A company a conseiller prepares in a workspace (E05.08) is that
// workspace's content: the connection reaches it only if that workspace was allowed.
@Injectable()
export class McpAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dossiers: DossiersService,
    private readonly workspaces: WorkspaceAccessService,
  ) {}

  // Whether the person allowed this connection to reach the workspace (null: no workspace).
  allows(caller: McpCaller, workspaceId: string | null): boolean {
    return workspaceId === null || caller.workspaceIds.includes(workspaceId)
  }

  // The workspace a tool names (UUID or slug), for the caller, at this call: allowed to the
  // connection, then resolved by the single access rule. Noted in `trace` once reached.
  async workspace(caller: McpCaller, ref: string, trace: ToolTrace): Promise<WorkspaceScope> {
    const id = UUID.test(ref)
      ? ref
      : (await this.prisma.workspace.findUnique({ where: { slug: ref }, select: { id: true } }))?.id
    if (!id || !this.allows(caller, id)) throw new ToolError(WORKSPACE_NOT_FOUND)
    let scope: WorkspaceScope
    try {
      scope = await this.workspaces.resolve(caller.user, id)
    } catch (err) {
      if (err instanceof NotFoundException) throw new ToolError(WORKSPACE_NOT_FOUND)
      throw err
    }
    trace.workspaceId = scope.workspace.id
    return scope
  }

  // A dossier the caller may read (its owner, or a financeur through a share), by UUID or slug. Once
  // access is granted, the dossier is noted in `trace`: the call is journaled with it even if it
  // fails afterwards (code review R20). A dossier the caller may not access — of a company prepared
  // in a workspace this connection may not reach included — is never noted, and reads as unknown.
  async dossier(caller: McpCaller, ref: string, trace: ToolTrace) {
    let id = ref
    if (!UUID.test(ref)) {
      const bySlug = await this.prisma.dossier.findUnique({
        where: { slug: ref },
        select: { id: true },
      })
      if (!bySlug) throw new NotFoundException()
      id = bySlug.id
    }
    const { dossier, accessLevel, relation } = await this.dossiers.resolveReadAccess(
      id,
      caller.user,
    )
    if (relation === 'owner' && !(await this.reachesCompany(caller, dossier.companyId))) {
      throw new NotFoundException()
    }
    trace.dossierId = dossier.id
    return { row: dossier, accessLevel, relation }
  }

  // The dossier, for its owner only (`message` otherwise).
  async ownedDossier(
    caller: McpCaller,
    ref: string,
    trace: ToolTrace,
    message: string,
  ): Promise<Dossier> {
    const { row, relation } = await this.dossier(caller, ref, trace)
    if (relation !== 'owner' || row.userId !== caller.user.id) throw new ToolError(message)
    return row
  }

  // Whether the connection reaches a company the account works on: its own, or one prepared in a
  // workspace it was allowed to reach.
  async reachesCompany(caller: McpCaller, companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { preparedInWorkspaceId: true },
    })
    return !!company && this.allows(caller, company.preparedInWorkspaceId)
  }

  // The dossiers among `rows` this connection reaches (see reachesCompany), in their order.
  async reachableDossiers<T extends Pick<Dossier, 'companyId' | 'userId'>>(
    caller: McpCaller,
    rows: T[],
  ): Promise<T[]> {
    const owned = rows.filter((r) => r.userId === caller.user.id)
    if (owned.length === 0) return rows
    const companies = await this.prisma.company.findMany({
      where: { id: { in: [...new Set(owned.map((r) => r.companyId))] } },
      select: { id: true, preparedInWorkspaceId: true },
    })
    const blocked = new Set(
      companies.filter((c) => !this.allows(caller, c.preparedInWorkspaceId)).map((c) => c.id),
    )
    return rows.filter((r) => r.userId !== caller.user.id || !blocked.has(r.companyId))
  }
}

// Messages for what a service reports as not found, by its code: each tells where to look instead.
const NOT_FOUND_HINTS: Record<string, string> = {
  DOSSIER_NOT_FOUND: 'Dossier introuvable, ou vous n’y avez pas accès. Utilisez list_dossiers.',
  COMPANY_NOT_FOUND: 'Entreprise introuvable, ou vous n’y avez pas accès. Utilisez list_companies.',
  CANDIDATURE_NOT_FOUND:
    'Candidature introuvable, ou vous n’y avez pas accès. Utilisez list_candidatures.',
  DOCUMENT_NOT_FOUND:
    'Document introuvable dans la bibliothèque de cette entreprise. Utilisez list_documents (libraryDocumentId).',
  DOCUMENT_VERSION_NOT_FOUND:
    'Cette version n’appartient pas à ce document. Utilisez list_documents (previousVersions).',
  WORKSPACE_NOT_FOUND: WORKSPACE_NOT_FOUND,
}

// Runs a service operation and passes its refusal on to the assistant as the site shows it (the
// services' messages are written for people, in French), with what is missing when it lists it.
export async function serviceCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (!(err instanceof HttpException)) throw err
    const body = err.getResponse() as
      | { code?: unknown; message?: unknown; details?: unknown }
      | string
    if (typeof body !== 'object') throw err
    const code = typeof body.code === 'string' ? body.code : ''
    if (NOT_FOUND_HINTS[code]) throw new ToolError(NOT_FOUND_HINTS[code])
    if (typeof body.message !== 'string') throw err
    const details = Array.isArray(body.details)
      ? (body.details as Array<{ message?: unknown; label?: unknown; fieldId?: unknown }>)
          .map((d) => {
            const text = typeof d.message === 'string' ? d.message : d.label
            if (typeof text !== 'string') return ''
            return `\n- ${text}${typeof d.fieldId === 'string' ? ` (fieldId ${d.fieldId})` : ''}`
          })
          .join('')
      : ''
    throw new ToolError(body.message + details)
  }
}
