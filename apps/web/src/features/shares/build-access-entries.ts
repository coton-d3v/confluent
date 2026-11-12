import type { PerRecipientAnalytics, ReadingSessionSummary, ShareAccess } from '@confluent/shared'
import { formatActiveTime, formatConsultedAt } from '@/features/analytics/format'
import { deriveInitials, type AccessConsultation, type AccessEntry } from './access-entry'

function formatRevokedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// E07.08: a consultation is a reading session — reloads and redirections within 30 minutes count once.
function formatLastSeen(analytics: PerRecipientAnalytics | undefined, status: string): string {
  if (analytics && analytics.viewCount > 0 && analytics.lastViewedAt) {
    const views = `${analytics.viewCount} consultation${analytics.viewCount > 1 ? 's' : ''}`
    return `${views} · dernière le ${formatConsultedAt(analytics.lastViewedAt)}`
  }
  if (status === 'pending') return 'Invitation envoyée'
  if (status === 'revoked') return 'Accès révoqué'
  return 'Invitation envoyée, pas encore consulté'
}

const PAGES: Record<ReadingSessionSummary['channel'], string> = {
  share: 'par le lien',
  opportunity: 'depuis ses opportunités',
}

function consultationsOf(analytics: PerRecipientAnalytics): AccessConsultation[] {
  return analytics.sessions.map((s) => ({
    key: s.startedAt,
    label:
      `${formatConsultedAt(s.startedAt)} ${PAGES[s.channel] ?? PAGES.share} · ` +
      (s.activeSeconds === null
        ? 'durée non mesurée'
        : `${formatActiveTime(s.activeSeconds)} de temps actif`),
  }))
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
      sessionDuration: formatActiveTime(a?.activeSeconds ?? null),
      accessLevel: s.accessLevel,
      ...(a && a.viewCount > 0
        ? {
            consultations: consultationsOf(a),
            firstSeen: a.firstViewedAt ? formatConsultedAt(a.firstViewedAt) : undefined,
          }
        : {}),
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
