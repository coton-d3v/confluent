import { apiRequest } from '@/lib/api-client'

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

export interface ConnectedApplication {
  id: string
  application: { name: string; clientUri: string | null }
  scopes: Array<{ scope: string; label: string }>
  connectedAt: string
  lastUsedAt: string | null
  expiresAt: string
}

export function listConnectedApplications(): Promise<ConnectedApplication[]> {
  return apiRequest<ConnectedApplication[]>('/v1/oauth/grants')
}

export function revokeConnectedApplication(id: string): Promise<void> {
  return apiRequest<void>(`/v1/oauth/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
