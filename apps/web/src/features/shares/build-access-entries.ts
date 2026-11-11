import type { PerRecipientAnalytics, ShareAccess } from '@confluent/shared'
import { deriveInitials, type AccessEntry } from './access-entry'

function formatRevokedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatLastSeen(analytics: PerRecipientAnalytics | undefined, status: string): string {
  if (analytics && analytics.viewCount > 0 && analytics.lastViewedAt) {
    const date = new Date(analytics.lastViewedAt)
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
    const views = `${analytics.viewCount} vue${analytics.viewCount > 1 ? 's' : ''}`
    if (days <= 0) return `Vu aujourd'hui · ${views}`
    if (days === 1) return `Vu hier · ${views}`
    return `Vu il y a ${days} jours · ${views}`
  }
  if (status === 'pending') return 'Invitation envoyée'
  if (status === 'revoked') return 'Accès révoqué'
  return 'Invitation envoyée, pas encore consulté'
}

// Who revoked an access (E07.01), named for whoever reads the list: its owner, or an administrator.
const REVOKED_BY: Record<'owner' | 'admin', Record<'owner' | 'admin', string>> = {
  owner: { owner: 'vous', admin: 'l’administration' },
  admin: { owner: 'le porteur de projet', admin: 'l’administration' },
}

export function buildAccessEntries(
  shares: ShareAccess[],
  analytics: { perRecipient: PerRecipientAnalytics[] } | undefined,
  reader: 'owner' | 'admin' = 'owner',
): AccessEntry[] {
  const analyticsByLinkId = new Map<string, PerRecipientAnalytics>()
  for (const r of analytics?.perRecipient ?? []) {
    analyticsByLinkId.set(r.shareLinkId, r)
  }
  return shares.map((s) => {
    const a = analyticsByLinkId.get(s.id)
    const lastSeen = formatLastSeen(a, s.status)
    const base = {
      id: s.id,
      email: s.recipientEmail,
      initials: deriveInitials(s.recipientEmail),
      lastSeen,
      sessionDuration: '—',
      accessLevel: s.accessLevel,
    }
    if (s.status === 'revoked') {
      const revokedIso = s.revokedAt ?? new Date().toISOString()
      return {
        ...base,
        status: 'revoked',
        revokedAt: formatRevokedAt(revokedIso),
        revokedAtIso: revokedIso,
        revokedBy: s.revokedBy ? REVOKED_BY[reader][s.revokedBy] : '—',
      }
    }
    if (s.status === 'expired') {
      return { ...base, status: 'revoked', revokedAt: '—', revokedAtIso: s.createdAt, revokedBy: '—' }
    }
    return { ...base, status: s.status }
  })
}
