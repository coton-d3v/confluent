import { FormErrors } from './form-errors'

// Whoever designs forms: the account behind the site's builder or behind an MCP tool call.
export interface FormDesigner {
  id: string
  role: string
}

// The single rule of who may design forms — list and read every form and version (drafts
// included), create, duplicate, edit, publish, archive — shared by the site's builder, the MCP tools
// and the OAuth consent (E04.07). Reading the published form of new dossiers, the one a project
// owner answers, is not designing: QuestionnairesService.getActive serves it without this rule.
// Closed by default: any role other than administrator, or unknown, is refused.
// Workspaces (E05) narrow it here and only here: every read and write of FormsService and
// FormDraftsService already goes through it with the acting account; the form's workspace will be
// passed next to it.
export function canDesignForms(actor: Pick<FormDesigner, 'role'>): boolean {
  return actor.role === 'admin'
}

// Checked first by every read and write of FormsService and FormDraftsService, whatever the caller:
// a form's existence is never told to whoever may not design.
export function assertCanDesignForms(actor: FormDesigner): void {
  if (!canDesignForms(actor)) throw FormErrors.designForbidden()
}
