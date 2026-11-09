import { getAuthState, sessionGeneration, setAuth } from '@/features/auth/auth-store'

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export interface ApiError {
  code: string
  message: string
  status: number
  details?: unknown
  // Seconds to wait before trying again, from a `Retry-After` header (429, 503).
  retryAfter?: number
}

function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After')
  if (!raw) return undefined
  const seconds = /^\d+$/.test(raw.trim()) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

// The request may succeed if repeated later: no answer (network), overload or server failure.
// Refusals (4xx other than 429) are final.
export function isTemporaryFailure(err: unknown): boolean {
  const status = (err as ApiError | undefined)?.status
  return typeof status !== 'number' || status === 429 || status >= 500
}

async function parseError(res: Response): Promise<ApiError> {
  const retryAfter = retryAfterOf(res)
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    return {
      code: body.error?.code ?? `HTTP_${res.status}`,
      message: body.error?.message ?? res.statusText,
      details: body.error?.details,
      status: res.status,
      retryAfter,
    }
  } catch {
    return { code: `HTTP_${res.status}`, message: res.statusText, status: res.status, retryAfter }
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
  // The account this request is sent for (code review R46). After a refresh it is replayed only for
  // that same account — a rotation of its session — never under another account signed in
  // meanwhile, nor for a request sent while signed out.
  const account = getAuthState().user?.id ?? null
  let res = await doFetch(path, init, true)
  if (res.status === 401 && opts.retryOn401 && account !== null) {
    const refreshed = await refreshSession()
    if (refreshed && getAuthState().user?.id === account) {
      res = await doFetch(path, init, true)
    }
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

export interface UploadOptions {
  // Share of the request body already sent, from 0 to 1.
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// Same contract as `apiRequest` (session, refresh replayed only for the same account, ApiError), for
// a multipart upload whose progress the page shows: `fetch` does not report upload progress.
export async function apiUpload<T>(path: string, body: FormData, opts: UploadOptions = {}): Promise<T> {
  const account = getAuthState().user?.id ?? null
  let res = await sendUpload(path, body, opts)
  if (res.status === 401 && account !== null) {
    const refreshed = await refreshSession()
    if (refreshed && getAuthState().user?.id === account) {
      opts.onProgress?.(0)
      res = await sendUpload(path, body, opts)
    }
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

function sendUpload(path: string, body: FormData, opts: UploadOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}${path}`)
    xhr.withCredentials = true
    const { accessToken } = getAuthState()
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      const headers = new Headers()
      const retryAfter = xhr.getResponseHeader('Retry-After')
      if (retryAfter) headers.set('Retry-After', retryAfter)
      // A 204 cannot carry a body in a Response.
      resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, headers }))
    }
    // No answer: same as a failed `fetch` (network error), the upload may be retried.
    xhr.onerror = () => reject(new TypeError('Network request failed'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    if (opts.signal) {
      if (opts.signal.aborted) return xhr.abort()
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
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
  // A sign-out or another sign-in while this refresh is in flight wins: its answer is then ignored.
  const startedAt = sessionGeneration()
  const stillCurrent = () => sessionGeneration() === startedAt
  // Superseded: report the session as it now is (signed in by another event, or signed out).
  const current = () => getAuthState().accessToken !== null
  try {
    const res = await doFetch('/v1/auth/refresh', { method: 'POST' }, false)
    if (!stillCurrent()) return current()
    if (!res.ok) {
      setAuth(null)
      return false
    }
    const body = (await res.json()) as {
      accessToken: string
      user: { id: string; email: string; role: 'entrepreneur' | 'financeur' | 'admin'; firstName: string | null; lastName: string | null }
    }
    if (!stillCurrent()) return current()
    setAuth({ accessToken: body.accessToken, user: body.user })
    return true
  } catch {
    if (!stillCurrent()) return current()
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
