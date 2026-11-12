import type { AccessLevel } from '@confluent/shared'

export type { AccessLevel }
export type AccessStatus = 'active' | 'pending' | 'revoked'

// One consultation of an access, as its owner reads it (E07.08).
export interface AccessConsultation {
  readonly key: string
  readonly label: string
}

interface AccessEntryBase {
  readonly id: string
  readonly email: string
  readonly initials: string
  readonly lastSeen: string
  // The active time of its measured consultations, or '—'.
  readonly sessionDuration: string
  readonly accessLevel: AccessLevel
  // E07.08: its first consultation and its latest ones, for the owner only (absent elsewhere).
  readonly firstSeen?: string
  readonly consultations?: ReadonlyArray<AccessConsultation>
}

export type AccessEntry =
  | (AccessEntryBase & { readonly status: 'active' | 'pending' })
  | (AccessEntryBase & {
      readonly status: 'revoked'
      readonly revokedAt: string
      readonly revokedAtIso: string
      // Who revoked it, as the reader names them (« vous », « l’administration »…), or '—'.
      readonly revokedBy: string
    })

export function deriveInitials(email: string): string {
  const localPart = email.split('@')[0] ?? ''
  const alpha = localPart.replace(/[^a-zA-Z]+/g, '').toUpperCase()
  if (alpha.length >= 2) return alpha.slice(0, 2)
  if (alpha.length === 1) return `${alpha}·`
  return '··'
}
