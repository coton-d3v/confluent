import { z } from 'zod';

export const auditActionSchema = z.enum([
  'magic_link_requested',
  'magic_link_consumed',
  'share_link_created',
  'share_link_viewed',
  'share_link_revoked',
  'dossier_created',
  'dossier_updated',
  'dossier_classified',
  'questionnaire_version_published',
  'user_deactivated',
  'user_reactivated',
  'rate_limit_exceeded',
  'share_link_access_denied',
  'admin_edited_field',
  'admin_uploaded_document',
  'admin_revoked_share_link',
  'share_link_access_requested',
  'session_revoked',
  'refresh_token_reused',
  'oauth_grant_created',
  'oauth_grant_revoked',
  'oauth_refresh_token_reused',
  'mcp_tool_called',
  'form_created',
  'form_updated',
  'form_draft_created',
  'form_draft_discarded',
]);

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  dossierId: z.string().uuid().nullable(),
  actorId: z.string().uuid().nullable(),
  shareLinkId: z.string().uuid().nullable(),
  actionType: auditActionSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
