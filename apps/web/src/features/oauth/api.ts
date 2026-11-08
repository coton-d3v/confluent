import type { ConnectedApplication } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export type { ConnectedApplication }

export interface OAuthConsentRequest {
  id: string
  client: {
    name: string
    redirectHost: string
    clientUri: string | null
    verifiedByMetadataDocument: boolean
  }
  scopes: Array<{ scope: string; label: string }>
  expiresAt: string
}

export function getConsentRequest(id: string): Promise<OAuthConsentRequest> {
  return apiRequest<OAuthConsentRequest>(`/v1/oauth/requests/${encodeURIComponent(id)}`)
}

export function decideConsentRequest(
  id: string,
  approve: boolean,
  scopes?: string[],
): Promise<{ redirectUrl: string }> {
  return apiRequest<{ redirectUrl: string }>(
    `/v1/oauth/requests/${encodeURIComponent(id)}/decision`,
    { method: 'POST', body: JSON.stringify({ approve, scopes }) },
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
