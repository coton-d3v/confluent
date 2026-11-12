import { z } from 'zod'
import { readingSessionSummarySchema } from './reading.schema.js'
import { shareLinkStatusSchema } from './share-link.schema.js'

// The readings of a request through its direct shares, for its owner (E07.08, reading.schema.ts): a
// view is a reading session. Durations are active time, in seconds, over the measured sessions only
// (`null` when none is: the sessions taken before E07.08 have no duration).
export const perRecipientAnalyticsSchema = z.object({
  shareLinkId: z.string().uuid(),
  recipientEmail: z.string().email(),
  status: shareLinkStatusSchema,
  viewCount: z.number().int().nonnegative(),
  firstViewedAt: z.string().datetime().nullable(),
  // The last activity of its latest session.
  lastViewedAt: z.string().datetime().nullable(),
  activeSeconds: z.number().int().nonnegative().nullable(),
  measuredSessions: z.number().int().nonnegative(),
  // The latest sessions first, at most `READING_SESSIONS_LISTED`.
  sessions: z.array(readingSessionSummarySchema),
})

export const dossierAnalyticsSchema = z.object({
  activeRecipients: z.number().int().nonnegative(),
  totalViews: z.number().int().nonnegative(),
  totalActiveSeconds: z.number().int().nonnegative().nullable(),
  avgSessionDurationSeconds: z.number().int().nonnegative().nullable(),
  perRecipient: z.array(perRecipientAnalyticsSchema),
})

export const platformAnalyticsSchema = z.object({
  totalDossiers: z.number().int().nonnegative(),
  activeThisMonth: z.number().int().nonnegative(),
  bySector: z.array(
    z.object({
      sector: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  byMaturityStage: z.array(
    z.object({
      stage: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  totalShareLinks: z.number().int().nonnegative(),
  totalViewsThisMonth: z.number().int().nonnegative(),
})

export type PerRecipientAnalytics = z.infer<typeof perRecipientAnalyticsSchema>
export type DossierAnalytics = z.infer<typeof dossierAnalyticsSchema>
export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>
