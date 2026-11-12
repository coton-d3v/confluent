import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { audit_action } from '@prisma/client'
import { auditActionSchema, ownerHistoryFilterSchema } from '@confluent/shared'
import {
  OWNER_HISTORY_RULES,
  actionsFor,
  listsConsultations,
  ownerRule,
} from './owner-history.rules'

// The journal's actions as the database declares them (`enum audit_action` of the Prisma schema).
function schemaActions(): string[] {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8')
  const body = /enum audit_action \{([\s\S]*?)\}/.exec(schema)?.[1] ?? ''
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[a-z_]+$/.test(line))
}

describe('owner history rules (E07.09)', () => {
  // Fails when an action is added to the journal without deciding whether its owner reads it.
  it('classifies every journal action, shown or hidden, and nothing else', () => {
    const classified = Object.keys(OWNER_HISTORY_RULES).sort()
    expect(schemaActions().length).toBeGreaterThan(60)
    expect(schemaActions().sort()).toEqual(classified)
    expect(Object.values(audit_action).sort()).toEqual(classified)
    expect([...auditActionSchema.options].sort()).toEqual(classified)
  })

  it('hides an action nobody classified', () => {
    expect(ownerRule('some_future_action')).toBeNull()
    expect(ownerRule('')).toBeNull()
    expect(ownerRule('toString')).toBeNull()
  })

  it('never shows the readers’ traces, the investors’ choices, the structures’ notes nor applications’ calls', () => {
    for (const action of [
      'share_link_viewed',
      'opportunity_viewed',
      'share_link_access_requested',
      'share_link_access_denied',
      'rate_limit_exceeded',
      'mcp_tool_called',
      'candidature_note_updated',
      'candidature_status_changed',
      'investor_interest_marked',
      'investor_interest_withdrawn',
      'investor_pledge_set',
      'investor_pledge_withdrawn',
      'investor_position_disclosed',
      'investor_position_disclosure_withdrawn',
      'committee_created',
      'committee_updated',
      'committee_status_changed',
      'committee_application_changed',
      'participation_request_received',
      'participation_request_discarded',
    ]) {
      expect([action, ownerRule(action)]).toEqual([action, null])
    }
  })

  it('lists under each filter the actions classified for it', () => {
    const shown = Object.entries(OWNER_HISTORY_RULES)
      .filter(([, r]) => r.shown)
      .map(([a]) => a)
      .sort()
    expect([...actionsFor('all')].sort()).toEqual(shown)
    expect(actionsFor('consultations')).toEqual([])
    expect([...actionsFor('access')].sort()).toEqual([
      'admin_revoked_share_link',
      'share_link_created',
      'share_link_level_changed',
      'share_link_revoked',
    ])
    expect([...actionsFor('administration')].sort()).toEqual([
      'admin_edited_field',
      'admin_revoked_share_link',
      'admin_uploaded_document',
      'dossier_classified',
    ])
    for (const action of actionsFor('administration')) {
      expect(ownerRule(action)?.byAdministration).toBe(true)
    }
    expect([...actionsFor('request')].sort()).toEqual([
      'dossier_archived',
      'dossier_published',
      'dossier_submitted',
      'dossier_unarchived',
      'dossier_unpublished',
    ])
    expect(ownerHistoryFilterSchema.options.filter(listsConsultations)).toEqual([
      'all',
      'consultations',
    ])
  })
})
