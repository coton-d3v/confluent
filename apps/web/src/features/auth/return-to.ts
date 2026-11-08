// Where to go after a magic-link login. Kept in localStorage (not sessionStorage) because the link is
// usually opened from the mail client, in another tab. Short-lived and restricted to known in-app
// paths so it cannot become an open redirect.
const KEY = 'confluent.returnTo'
const MAX_AGE_MS = 30 * 60 * 1000
const ALLOWED_PREFIXES = ['/oauth/consent']

export function rememberReturnTo(path: string): void {
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }))
  } catch {
    // storage unavailable (private mode…): the user lands on the dashboard instead
  }
}

export function hasPendingReturnTo(): boolean {
  return readReturnTo(false) !== null
}

export function consumeReturnTo(): string | null {
  return readReturnTo(true)
}

function readReturnTo(remove: boolean): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (remove) localStorage.removeItem(KEY)
    if (!raw) return null
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown }
    if (typeof path !== 'string' || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null
    return ALLOWED_PREFIXES.some((p) => path.startsWith(p)) ? path : null
  } catch {
    return null
  }
}
