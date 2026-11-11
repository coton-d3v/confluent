import type {
  ConnectedApplication,
  ConversationGuide,
  OAuthConsentDecision,
  OAuthConsentRequest,
  OAuthConsentWorkspace,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export type { ConnectedApplication, ConversationGuide, OAuthConsentRequest, OAuthConsentWorkspace }

export function getConsentRequest(id: string): Promise<OAuthConsentRequest> {
  return apiRequest<OAuthConsentRequest>(`/v1/oauth/requests/${encodeURIComponent(id)}`)
}

export function decideConsentRequest(
  id: string,
  decision: OAuthConsentDecision,
): Promise<{ redirectUrl: string }> {
  return apiRequest<{ redirectUrl: string }>(
    `/v1/oauth/requests/${encodeURIComponent(id)}/decision`,
    { method: 'POST', body: JSON.stringify(decision) },
  )
}

export function listConnectedApplications(): Promise<ConnectedApplication[]> {
  return apiRequest<ConnectedApplication[]>('/v1/oauth/applications')
}

// Revokes every connection of the application (code review R21).
export function revokeConnectedApplication(clientId: string): Promise<void> {
  return apiRequest<void>(`/v1/oauth/applications/${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  })
}

// E04.10: the conversation guides this account can follow with a connected assistant.
export function listConversationGuides(): Promise<ConversationGuide[]> {
  return apiRequest<ConversationGuide[]>('/v1/conversation-guides')
}
