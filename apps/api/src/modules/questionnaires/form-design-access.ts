import { FormErrors } from './form-errors'

// Whoever changes a form: the account behind the site's builder or behind an MCP tool call.
export interface FormDesigner {
  id: string
  role: string
}

// The single rule of who may design forms — create, duplicate, edit, publish, archive — shared by
// the site's builder, the MCP tools and the OAuth consent (E04.07). Closed by default: any role
// other than administrator, or unknown, is refused. Workspaces (E05) will narrow it here to the
// administrators of the form's workspace.
export function canDesignForms(actor: Pick<FormDesigner, 'role'>): boolean {
  return actor.role === 'admin'
}

// Checked by every write of FormsService and FormDraftsService, whatever the caller.
export function assertCanDesignForms(actor: FormDesigner): void {
  if (!canDesignForms(actor)) throw FormErrors.designForbidden()
}
