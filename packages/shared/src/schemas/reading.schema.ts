import { z } from 'zod'

// ROADMAP E07.08 — reading sessions: how the readings of a request are measured, and what its owner
// reads of them (D05 still open: where it is silent, the most restrictive option). This file is the
// only place where these rules are described; the API applies them, the site only measures what they
// let it send.
//
//  * A view is a reading session, opened by the server when a signed-in reader loads the request —
//    the page of a share link (`GET /v1/shares/:token`) or an opportunity (`GET
//    /v1/opportunities/:dossierId`). A load by the same account, of the same request, through the same
//    direct share (or through none), less than `READING_SESSION_GAP_MINUTES` after that session's last
//    activity, resumes it: reloads, redirections (sign-in included), React's double effects and a
//    second tab are one view. Concurrent loads open one session (the reader and the request are locked
//    together). The journal keeps one entry per session (`share_link_viewed` or `opportunity_viewed`).
//  * Active time is measured by the reader's page and credited by the server: every
//    `READING_HEARTBEAT_INTERVAL_SECONDS`, the page sends how long it was shown in the foreground with
//    the reader active (an interaction within `READING_IDLE_AFTER_SECONDS`) — never a total. The server
//    credits at most the time elapsed since the session's last activity, and at most
//    `READING_HEARTBEAT_MAX_MS` per heartbeat: two tabs, a retried or a forged heartbeat never add more
//    than wall-clock time. A session holds at most `READING_SESSION_MAX_ACTIVE_SECONDS`. A heartbeat is
//    accepted only from the session's reader (another account: 404), while the session is open (last
//    activity within the gap) and they still read the request through that share (active, sent to
//    their address); otherwise it credits nothing and says the session is closed.
//  * What is measured: only the readings through a direct share — the owner chose its recipient and
//    reads, per share, its views, the first and last consultations, the dates and active time of each
//    session. The readings of a pool's investors without a direct share are journaled (the
//    administrators' raw journal) but neither timed nor shown to the owner — not even a count: they
//    consented to nothing towards the owner (D05; as for the structures, E07.07). The readings taken
//    before E07.08 are grouped by the same rule from the journal, without a measured duration.
//  * Measured time is not interest: a page left open while the reader does something else in the same
//    window, a fast reader or a reading printed or shared further all distort it. The site says so
//    wherever it shows it.
//  * Nobody else reads the measures: neither the workspaces' conseillers, nor other readers; the
//    administrators keep their platform count of views and the raw journal.

export const READING_SESSION_GAP_MINUTES = 30
export const READING_HEARTBEAT_INTERVAL_SECONDS = 15
export const READING_HEARTBEAT_MAX_MS = 30_000
export const READING_IDLE_AFTER_SECONDS = 60
export const READING_SESSION_MAX_ACTIVE_SECONDS = 3 * 60 * 60

// On the reader's page (`share.reading`, `opportunity.reading`): the session to send heartbeats for,
// `null` when the reading is not measured (no direct share).
export const readingSchema = z.object({ id: z.string().uuid() })
export type Reading = z.infer<typeof readingSchema>

// Body of `POST /v1/reading-sessions/:id/heartbeat`: the active time since the previous heartbeat.
export const readingHeartbeatSchema = z
  .object({
    activeMs: z.number().int().min(0).max(READING_HEARTBEAT_MAX_MS),
  })
  .strict()
export type ReadingHeartbeatInput = z.infer<typeof readingHeartbeatSchema>

// `open: false` — the session is over (gap exceeded, access ended): the page stops measuring.
export const readingHeartbeatResultSchema = z.object({ open: z.boolean() })
export type ReadingHeartbeatResult = z.infer<typeof readingHeartbeatResultSchema>

export const readingChannelSchema = z.enum(['share', 'opportunity'])
export type ReadingChannel = z.infer<typeof readingChannelSchema>

// One session as the owner reads it: when it started, its last activity, its active time (`null`:
// not measured — taken before E07.08) and the page it was opened on.
export const readingSessionSummarySchema = z.object({
  startedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  activeSeconds: z.number().int().nonnegative().nullable(),
  channel: readingChannelSchema,
})
export type ReadingSessionSummary = z.infer<typeof readingSessionSummarySchema>

// How many sessions of a share the owner reads in detail (the latest).
export const READING_SESSIONS_LISTED = 10
