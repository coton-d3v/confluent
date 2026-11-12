-- Reverts migration 20261214000000_performance_indexes (ROADMAP E10.08) before the application is
-- rolled back to E10.07. Nothing is lost: two indexes, no data. The earlier application reads the
-- same rows, only more slowly (who revoked a share: over the whole journal; the unread count: over
-- every notification of the account). To be run FIRST, before the reverts of E10.03 and earlier.
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261214000000_performance_indexes';
-- Exercised by test/pg/performance.pg-spec.ts (revert, then apply the migration again).

DROP INDEX IF EXISTS "notifications_unread_recipient_id_idx";

DROP INDEX IF EXISTS "audit_log_share_link_id_idx";
