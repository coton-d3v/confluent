# Story 8.3: Financeur Session Tracking & Analytics

Status: done

## AC

1. `GET /v1/dossiers/:id/analytics` (entrepreneur, ownership-scoped) returns:
   - `activeRecipients`: count of share_links with `status: 'active'` on the dossier.
   - `totalViews`: number of `share_link_viewed` audit entries for the dossier.
   - `perRecipient`: array `{ shareLinkId, recipientEmail, status, viewCount, lastViewedAt }` per share link.
   - `avgSessionDurationSeconds`: `null` for V1 (session-boundary heuristic deferred — no session durations captured yet at ingestion).
2. Missing-data safe: never divides by zero, returns `null` for `lastViewedAt`/`avgSessionDurationSeconds` when no views.
3. Unit + e2e tests mock Prisma + audit queries.

## Tasks

- [ ] AnalyticsService + spec
- [ ] Controller route under DossiersModule (or new AnalyticsModule)
- [ ] Tests + commit

## File List
