// ROADMAP E10.10: a deleted account's address, wherever it is a whole value of a journal entry's
// metadata (`recipientEmail`, `email`, an element of a list…), becomes its pseudonym. Whole values
// only (code review R64): an address that merely contains it (`x.alice@corp.fr` for `alice@corp.fr`)
// or a text that cites it is left as it is; compared without case nor surrounding spaces, as
// addresses are everywhere else. Returns the same object when nothing changed.
export function replaceWholeValue(value: unknown, target: string, replacement: string): unknown {
  const wanted = target.trim().toLowerCase()
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.trim().toLowerCase() === wanted ? replacement : v
    if (Array.isArray(v)) {
      const next = v.map(walk)
      return next.some((x, i) => x !== v[i]) ? next : v
    }
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      const next = entries.map(([k, x]) => [k, walk(x)] as const)
      return next.some(([, x], i) => x !== entries[i][1]) ? Object.fromEntries(next) : v
    }
    return v
  }
  return walk(value)
}

// The journal keys that describe the person's own connection or words, erased from their entries
// when their account is deleted (and the network ones from everyone's after a year, `RETENTION_DAYS`).
export const NETWORK_KEYS = ['ip', 'userAgent'] as const
export const PERSONAL_KEYS = [...NETWORK_KEYS, 'instruction'] as const

// The pseudonym of a deleted account (from its request), and the address that replaces its own.
export const subjectRefOf = (requestId: string): string =>
  `compte-supprime-${requestId.replace(/-/g, '').slice(0, 8)}`
export const pseudonymousAddress = (subjectRef: string): string => `${subjectRef}@confluent.invalid`
