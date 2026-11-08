import { publicApiRequest, apiRequest, refreshSession } from '@/lib/api-client'
import { setAuth, getAuthState, type AuthUser } from './auth-store'

interface SessionResponse {
  accessToken: string
  user: AuthUser
}

export async function requestMagicLink(email: string): Promise<void> {
  await publicApiRequest<{ message: string }>('/v1/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function verifyMagicLink(token: string): Promise<AuthUser> {
  const body = await publicApiRequest<SessionResponse>(
    `/v1/auth/verify?token=${encodeURIComponent(token)}`,
    { method: 'GET' },
  )
  setAuth({ accessToken: body.accessToken, user: body.user })
  return body.user
}

export async function updateProfile(firstName: string, lastName: string): Promise<void> {
  const body = await apiRequest<{ firstName: string; lastName: string }>(
    '/v1/auth/profile',
    { method: 'PATCH', body: JSON.stringify({ firstName, lastName }) },
  )
  const { accessToken, user } = getAuthState()
  if (user && accessToken) {
    setAuth({ accessToken, user: { ...user, firstName: body.firstName, lastName: body.lastName } })
  }
}

// Restores the session from the refresh cookie; shares the in-flight refresh with apiRequest.
export async function initAuth(): Promise<void> {
  await refreshSession()
}

export async function logout(): Promise<void> {
  try {
    await publicApiRequest<{ message: string }>('/v1/auth/logout', { method: 'POST' })
  } finally {
    setAuth(null)
  }
}
