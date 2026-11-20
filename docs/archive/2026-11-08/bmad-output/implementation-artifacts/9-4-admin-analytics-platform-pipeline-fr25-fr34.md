# Story 9.4: Admin Analytics & Platform Pipeline

Status: done

## AC

1. `GET /v1/admin/analytics` (AdminGuard) returns `{ totalDossiers, activeThisMonth, bySector, byMaturityStage, totalShareLinks, totalViewsThisMonth }`.
2. Empty-db safe: all counts 0, arrays [].
3. Unit + e2e tests mock prisma aggregates.

## Tasks

- [ ] AdminAnalyticsService + controller
- [ ] Tests + commit

## File List
