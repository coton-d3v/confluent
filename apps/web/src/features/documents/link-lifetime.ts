import type { DocumentGroup } from '@confluent/shared'

// ROADMAP E10.06: a download link is a signed URL the API makes valid for 15 minutes; followed later,
// the storage answers its own error page. Pages that do not list their documents again on a timer
// (a share, an opportunity) note when each version reached the browser, to say so instead. One
// minute of margin; the browser's clock only, never compared with the server's.
const USABLE_MS = 14 * 60 * 1000
const receivedAt = new WeakMap<object, number>()

export function markLinksReceived<T extends { documents: DocumentGroup[] }>(view: T): T {
  const now = Date.now()
  for (const document of view.documents) {
    receivedAt.set(document.current, now)
    for (const version of document.versions) receivedAt.set(version, now)
  }
  return view
}

export function linkExpired(version: object): boolean {
  const at = receivedAt.get(version)
  return at !== undefined && Date.now() - at > USABLE_MS
}
