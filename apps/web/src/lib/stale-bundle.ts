// ROADMAP E10.06: after a deploy, a page opened before it may ask for a script file the new version no
// longer has. Reloading once loads the new version; a second failure within a minute is shown as an
// error instead (no reload loop).
const RELOADED_AT = 'confluent_stale_bundle_reload'
const LOOP_WINDOW_MS = 60_000

const PATTERNS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Unable to preload CSS',
]

export function isStaleBundleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return PATTERNS.some((pattern) => message.includes(pattern))
}

// Whether the page may reload itself: not if it already did in the last minute, nor when storage is
// refused (then a first failure cannot be told from a loop).
export function mayReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT) ?? 0)
    return Date.now() - last >= LOOP_WINDOW_MS
  } catch {
    return false
  }
}

// Reloads the page if it may; true when it reloads.
export function reloadOnce(): boolean {
  if (!mayReload()) return false
  try {
    window.sessionStorage.setItem(RELOADED_AT, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
