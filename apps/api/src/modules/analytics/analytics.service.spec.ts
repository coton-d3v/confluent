import type { ReadingSession, ShareLink } from '@prisma/client'
import { shareReadings } from './analytics.service'

const link = (id: string, status = 'active') =>
  ({ id, status, recipientEmail: `${id}@x.fr`, dossierId: 'd-1' }) as ShareLink

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 9, minutes))

const session = (
  shareLinkId: string | null,
  start: number,
  end: number,
  activeMs: number | null,
  channel = 'share',
) =>
  ({
    id: `${shareLinkId}-${start}`,
    dossierId: 'd-1',
    readerId: 'u-1',
    shareLinkId,
    channel,
    startedAt: at(start),
    lastSeenAt: at(end),
    activeMs,
  }) as ReadingSession

// ROADMAP E07.08: what the owner reads of the readings of their request's direct shares.
describe('shareReadings', () => {
  it('reads nothing without shares, and zero views for a share never read', () => {
    expect(shareReadings([], [])).toEqual({
      activeRecipients: 0,
      totalViews: 0,
      totalActiveSeconds: null,
      avgSessionDurationSeconds: null,
      perRecipient: [],
    })
    expect(shareReadings([link('a')], []).perRecipient).toEqual([
      {
        shareLinkId: 'a',
        recipientEmail: 'a@x.fr',
        status: 'active',
        viewCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        activeSeconds: null,
        measuredSessions: 0,
        sessions: [],
      },
    ])
  })

  it('counts a view per session, with its dates and the active time of the measured ones only', () => {
    const result = shareReadings(
      [link('a'), link('b', 'revoked')],
      [
        // Taken before E07.08: a view, without duration.
        session('a', 0, 5, null),
        session('a', 60, 75, 42_400, 'opportunity'),
        session('a', 120, 121, 0),
        session('b', 10, 12, 90_000),
      ],
    )
    expect(result).toMatchObject({
      activeRecipients: 1,
      totalViews: 4,
      // 42.4 + 0 + 90 s over the three measured sessions.
      totalActiveSeconds: 132,
      avgSessionDurationSeconds: 44,
    })
    expect(result.perRecipient[0]).toEqual({
      shareLinkId: 'a',
      recipientEmail: 'a@x.fr',
      status: 'active',
      viewCount: 3,
      firstViewedAt: at(0),
      lastViewedAt: at(121),
      activeSeconds: 42,
      measuredSessions: 2,
      sessions: [
        { startedAt: at(120), lastSeenAt: at(121), activeSeconds: 0, channel: 'share' },
        { startedAt: at(60), lastSeenAt: at(75), activeSeconds: 42, channel: 'opportunity' },
        { startedAt: at(0), lastSeenAt: at(5), activeSeconds: null, channel: 'share' },
      ],
    })
    expect(result.perRecipient[1]).toMatchObject({ viewCount: 1, activeSeconds: 90 })
  })

  it('never counts a reading through pools alone, nor another request’s share', () => {
    const result = shareReadings([link('a')], [session(null, 0, 3, null), session('z', 0, 3, 5000)])
    expect(result.totalViews).toBe(0)
    expect(result.totalActiveSeconds).toBeNull()
    expect(result.perRecipient[0].viewCount).toBe(0)
  })

  it('details the ten latest sessions of a share and counts them all', () => {
    const many = Array.from({ length: 12 }, (_, i) => session('a', i * 40, i * 40 + 1, 1000))
    const [entry] = shareReadings([link('a')], many).perRecipient
    expect(entry.viewCount).toBe(12)
    expect(entry.activeSeconds).toBe(12)
    expect(entry.sessions).toHaveLength(10)
    expect(entry.sessions[0].startedAt).toEqual(at(440))
    expect(entry.sessions[9].startedAt).toEqual(at(80))
  })
})
