import type { audit_action } from '@prisma/client'
import type { OwnerHistoryFilter, OwnerHistoryKind } from '@confluent/shared'

// ROADMAP E07.09 — which journal entries of a request its owner reads, as which history entry
// (rules in @confluent/shared `owner-history.schema.ts`). Every journal action is classified here,
// once: shown — as a kind of entry, under the filters that list it — or hidden, with why. The map is
// typed against the journal's enum and `owner-history.rules.spec.ts` reads the Prisma schema, so a new
// action is hidden until it is classified, and the tests fail until it is.

export interface ShownAction {
  shown: true
  kind: OwnerHistoryKind
  byAdministration: boolean
  filters: readonly Exclude<OwnerHistoryFilter, 'all' | 'consultations'>[]
}

export interface HiddenAction {
  shown: false
  because: string
}

const shown = (
  kind: OwnerHistoryKind,
  filters: ShownAction['filters'],
  byAdministration = false,
): ShownAction => ({ shown: true, kind, byAdministration, filters })
const hidden = (because: string): HiddenAction => ({ shown: false, because })

// The readings are shown from the reading sessions (E07.08: one per view, the direct shares only);
// their journal entries carry the reader's IP address and browser.
const READING = hidden('readings come from the reading sessions; the entry carries IP and browser')
const SECURITY = hidden('security trace (accounts, sessions, refused or requested accesses, rates)')
const PLATFORM = hidden('the platform’s forms, rules and workspaces, not this request')
const CANDIDATURE = hidden(
  'a candidature’s follow-up, read in its own view (E05.09–E06.07), which never names a conseiller',
)
// D05: the investors consented to nothing towards the owner beyond their own views (E07.05–E07.07).
const INVESTOR = hidden('an investor’s own choice, read through E07.05–E07.07 views only (D05)')

export const OWNER_HISTORY_RULES = {
  share_link_created: shown('share_created', ['access']),
  share_link_level_changed: shown('share_level_changed', ['access']),
  share_link_revoked: shown('share_revoked', ['access']),
  admin_revoked_share_link: shown('share_revoked', ['access', 'administration'], true),
  admin_edited_field: shown('answer_edited', ['administration'], true),
  // Only written by an administrator's reclassification after new rules (E03.12).
  dossier_classified: shown('classification_updated', ['administration'], true),
  // Not written yet (E10.05): its description names no detail of the entry.
  admin_uploaded_document: shown('document_added', ['administration'], true),
  dossier_submitted: shown('request_submitted', ['request']),
  dossier_published: shown('request_published', ['request']),
  dossier_unpublished: shown('request_unpublished', ['request']),
  dossier_archived: shown('request_archived', ['request']),
  dossier_unarchived: shown('request_unarchived', ['request']),

  share_link_viewed: READING,
  opportunity_viewed: READING,
  share_link_access_denied: SECURITY,
  share_link_access_requested: SECURITY,
  rate_limit_exceeded: SECURITY,
  magic_link_requested: SECURITY,
  magic_link_consumed: SECURITY,
  session_revoked: SECURITY,
  refresh_token_reused: SECURITY,
  oauth_grant_created: SECURITY,
  oauth_grant_revoked: SECURITY,
  oauth_refresh_token_reused: SECURITY,
  user_deactivated: SECURITY,
  user_reactivated: SECURITY,
  // Whoever called — a recipient reading through MCP included. The owner's consequential actions
  // through an application are shown by their own entries, with the application.
  mcp_tool_called: hidden('an application’s call, by whoever made it, with what it was asked'),
  // Never written: a request's creation and edits are its own pages.
  dossier_created: hidden('not written'),
  dossier_updated: hidden('not written'),
  questionnaire_version_published: PLATFORM,
  form_created: PLATFORM,
  form_updated: PLATFORM,
  form_draft_created: PLATFORM,
  form_draft_discarded: PLATFORM,
  classification_rules_updated: PLATFORM,
  workspace_created: PLATFORM,
  workspace_updated: PLATFORM,
  workspace_member_invited: PLATFORM,
  workspace_member_updated: PLATFORM,
  workspace_member_deactivated: PLATFORM,
  workspace_member_reactivated: PLATFORM,
  funding_source_categories_updated: PLATFORM,
  eligibility_schemes_updated: PLATFORM,
  support_steps_updated: PLATFORM,
  document_type_changed: hidden('the owner’s own library work, read in the documents'),
  document_version_restored: hidden('the owner’s own library work, read in the documents'),
  dossier_document_selected: hidden('the owner’s own library work, read in the documents'),
  dossier_document_unselected: hidden('the owner’s own library work, read in the documents'),
  company_prepared: hidden('the company’s preparation and transfer, read on the company (E05.08)'),
  company_transfer_invited: hidden('the company’s transfer, read on the company (E05.08)'),
  company_transfer_accepted: hidden('the company’s transfer, read on the company (E05.08)'),
  company_transfer_declined: hidden('the company’s transfer, read on the company (E05.08)'),
  company_transfer_cancelled: hidden('the company’s transfer, read on the company (E05.08)'),
  candidature_created: CANDIDATURE,
  candidature_submitted: CANDIDATURE,
  candidature_withdrawn: CANDIDATURE,
  candidature_status_changed: CANDIDATURE,
  funding_plan_updated: CANDIDATURE,
  candidature_eligibility_updated: CANDIDATURE,
  candidature_support_step_updated: CANDIDATURE,
  pool_publication_published: CANDIDATURE,
  pool_publication_withdrawn: CANDIDATURE,
  // E06.08: the structure's internal notes — the owner does not even learn that notes exist.
  candidature_note_updated: hidden('a structure’s internal notes (E06.08)'),
  investor_interest_marked: INVESTOR,
  investor_interest_withdrawn: INVESTOR,
  investor_pledge_set: INVESTOR,
  investor_pledge_withdrawn: INVESTOR,
  investor_position_disclosed: INVESTOR,
  investor_position_disclosure_withdrawn: INVESTOR,
  // E08.01: a workspace's committees, read by its conseillers; no request is attached to one yet.
  committee_created: PLATFORM,
  committee_updated: PLATFORM,
  committee_status_changed: PLATFORM,
  // E08.03: a request's entries on committees, read by its owner on the candidature (with the side
  // that changed them, never the conseiller).
  committee_application_changed: CANDIDATURE,
  // E08.04: a request to take part in committees, sent by someone outside the workspace from its
  // public form; it concerns no request of an owner.
  participation_request_received: PLATFORM,
  participation_request_discarded: SECURITY,
  // E08.05: a manager's decision on such a request (and the account it admitted).
  participation_request_decided: PLATFORM,
  // E09.02: a request's card on a workspace's public page, read by its owner on the candidature like
  // its pool publication.
  showcase_card_published: CANDIDATURE,
  showcase_card_withdrawn: CANDIDATURE,
  // E09.03: hidden or restored by the workspace's managers, read by the owner on the card
  // (« masquée par la structure »), never naming who.
  showcase_card_hidden: CANDIDATURE,
  showcase_card_unhidden: CANDIDATURE,
} as const satisfies Record<audit_action, ShownAction | HiddenAction>

// Closed by default: an action missing from the map (a value added to the enum, a value read from a
// database ahead of the code) is hidden.
export function ownerRule(action: string): ShownAction | null {
  const rule = (OWNER_HISTORY_RULES as Record<string, ShownAction | HiddenAction | undefined>)[
    action
  ]
  return rule?.shown ? rule : null
}

// The journal actions a filter lists; `all`: every shown action.
export function actionsFor(filter: OwnerHistoryFilter): audit_action[] {
  return (Object.entries(OWNER_HISTORY_RULES) as Array<[audit_action, ShownAction | HiddenAction]>)
    .filter(
      ([, rule]) =>
        rule.shown && (filter === 'all' || (rule.filters as readonly string[]).includes(filter)),
    )
    .map(([action]) => action)
}

// Whether a filter lists the consultations (from the reading sessions).
export const listsConsultations = (filter: OwnerHistoryFilter) =>
  filter === 'all' || filter === 'consultations'
