import { getAuthState, setAuth } from '@/features/auth/auth-store'

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export interface ApiError {
  code: string
  message: string
  status: number
  details?: unknown
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    return {
      code: body.error?.code ?? `HTTP_${res.status}`,
      message: body.error?.message ?? res.statusText,
      details: body.error?.details,
      status: res.status,
    }
  } catch {
    return { code: `HTTP_${res.status}`, message: res.statusText, status: res.status }
  }
}

async function doFetch(path: string, init: RequestInit, withAuth: boolean): Promise<Response> {
  const headers = new Headers(init.headers)
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (withAuth) {
    const { accessToken } = getAuthState()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include', headers })
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  opts: { retryOn401?: boolean } = { retryOn401: true },
): Promise<T> {
  let res = await doFetch(path, init, true)
  if (res.status === 401 && opts.retryOn401) {
    const refreshed = await refreshSession()
    if (refreshed) {
      res = await doFetch(path, init, true)
    }
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

// Refresh tokens are single-use server-side (rotation). Concurrent 401s — or the boot loader racing a
// request — must share ONE refresh call: a second call with the same cookie would be refused and log
// the user out.
let refreshInFlight: Promise<boolean> | null = null

export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await doFetch('/v1/auth/refresh', { method: 'POST' }, false)
    if (!res.ok) {
      setAuth(null)
      return false
    }
    const body = (await res.json()) as {
      accessToken: string
      user: { id: string; email: string; role: 'entrepreneur' | 'financeur' | 'admin'; firstName: string | null; lastName: string | null }
    }
    setAuth({ accessToken: body.accessToken, user: body.user })
    return true
  } catch {
    setAuth(null)
    return false
  }
}

export function publicApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (async () => {
    const res = await doFetch(path, init, false)
    if (!res.ok) throw await parseError(res)
    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  })()
}
