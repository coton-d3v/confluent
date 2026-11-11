import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  WorkspaceAccessService,
  canManageWorkspace,
  type ManagingMembership,
} from '../workspaces/workspace-access'
import { FormErrors } from './form-errors'

// Whoever designs forms: the account behind the site's builder or behind an MCP tool call, and
// where (E05.09): Confluent's own forms — the company profile… — when `workspaceId` is absent or
// null, otherwise the forms of that workspace. The workspace is the one the request names (its URL),
// never a value read from a body.
export interface FormDesigner {
  id: string
  role: string
  workspaceId?: string | null
}

// The single rule of who may design forms — list and read every form and version (drafts
// included), create, duplicate, edit, publish, archive — shared by the site's builder, the MCP tools
// and the OAuth consent (E04.07). Reading the form one answers (the company profile, a workspace's
// complementary form) is not designing: QuestionnairesService.getActive and the candidatures serve
// it without this rule. Confluent's own forms: its administrators. A workspace's forms (E05.09):
// whoever manages that workspace (`canManageWorkspace` — its administrators, its active conseillers
// holding the right to manage it). Closed by default: any other role, or unknown, is refused.
export function canDesignForms(
  actor: Pick<FormDesigner, 'role'>,
  workspace?: { membership: ManagingMembership | null },
): boolean {
  if (workspace === undefined) return actor.role === 'admin'
  return canManageWorkspace(actor, workspace.membership)
}

// Checked first by every read and write of FormsService and FormDraftsService, whatever the caller:
// a form's existence is never told to whoever may not design. Confluent's forms only; the services
// go through FormDesignAccess, which also knows the workspaces.
export function assertCanDesignForms(actor: Pick<FormDesigner, 'role'>): void {
  if (!canDesignForms(actor)) throw FormErrors.designForbidden()
}

// The rule above with what it needs from the database, at each request: for a workspace's forms,
// the actor's membership, resolved by the workspaces' single access rule — `404` for a workspace the
// actor is not in, as for one that does not exist, then `403` for a member who may not manage it.
// Returns the workspace whose forms the actor designs (null: Confluent's), which every read and
// write then filters forms by.
@Injectable()
export class FormDesignAccess {
  constructor(private readonly workspaces: WorkspaceAccessService) {}

  async assert(actor: FormDesigner, tx?: Prisma.TransactionClient): Promise<string | null> {
    const workspaceId = actor.workspaceId ?? null
    if (workspaceId === null) {
      assertCanDesignForms(actor)
      return null
    }
    const scope = await this.workspaces.resolve(actor, workspaceId, tx)
    if (!canDesignForms(actor, scope)) throw FormErrors.workspaceDesignForbidden()
    return workspaceId
  }
}
