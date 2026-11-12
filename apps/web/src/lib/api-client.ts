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

// ROADMAP E10.06: no answer from the server (offline, connection refused or reset, or a session that
// could not be renewed for that reason), said in French. It carries no `status`, as a failed `fetch`
// did: every check that reads a missing status as « network » keeps doing so.
export class NetworkError extends Error {
  readonly code = 'NETWORK_ERROR'
  constructor() {
    super(
      'Le serveur Confluent ne répond pas pour le moment : vérifiez votre connexion internet, puis réessayez.',
    )
    this.name = 'NetworkError'
  }
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
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include', headers })
  } catch (err) {
    // `fetch` rejects with a TypeError when no answer came; an abort stays an AbortError.
    if (err instanceof TypeError) throw new NetworkError()
    throw err
  }
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
    const outcome = await refreshSession()
    if (outcome === 'renewed' && getAuthState().user?.id === account) {
      res = await doFetch(path, init, true)
    } else if (outcome === 'unreachable') {
      // The session was kept: this request failed for want of an answer, not of a session.
      throw new NetworkError()
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
    const outcome = await refreshSession()
    if (outcome === 'renewed' && getAuthState().user?.id === account) {
      opts.onProgress?.(0)
      res = await sendUpload(path, body, opts)
    } else if (outcome === 'unreachable') {
      throw new NetworkError()
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
    xhr.onerror = () => reject(new NetworkError())
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
// `renewed`: a new access token; `refused`: no session (signed out); `unreachable` (ROADMAP E10.06): no
// answer, or an overloaded or failing server — nothing says the session ended, so it is kept and the
// next request, or the next try, decides.
export type RenewalOutcome = 'renewed' | 'refused' | 'unreachable'

let refreshInFlight: Promise<RenewalOutcome> | null = null

export function refreshSession(): Promise<RenewalOutcome> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function doRefresh(): Promise<RenewalOutcome> {
  // A sign-out or another sign-in while this refresh is in flight wins: its answer is then ignored.
  const startedAt = sessionGeneration()
  const stillCurrent = () => sessionGeneration() === startedAt
  // Superseded: report the session as it now is (signed in by another event, or signed out).
  const current = (): RenewalOutcome => (getAuthState().accessToken !== null ? 'renewed' : 'refused')
  try {
    const res = await doFetch('/v1/auth/refresh', { method: 'POST' }, false)
    if (!stillCurrent()) return current()
    if (!res.ok) {
      if (isTemporaryFailure({ status: res.status })) return 'unreachable'
      setAuth(null)
      return 'refused'
    }
    const body = (await res.json()) as {
      accessToken: string
      user: { id: string; email: string; role: 'entrepreneur' | 'financeur' | 'admin'; firstName: string | null; lastName: string | null }
    }
    if (!stillCurrent()) return current()
    setAuth({ accessToken: body.accessToken, user: body.user })
    return 'renewed'
  } catch {
    if (!stillCurrent()) return current()
    return 'unreachable'
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
