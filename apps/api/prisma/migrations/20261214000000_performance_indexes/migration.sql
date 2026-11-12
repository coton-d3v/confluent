-- ROADMAP E10.08: indexes of two reads measured on a synthetic volume (2,000 requests, 40,000
-- journal entries, 18,000 notifications), no change of data or constraint.
--
--  * `audit_log (share_link_id)`: who revoked each revoked share of a request (`accessList`, read at
--    every load of the owner's page and after each revocation) was a sequential scan of the whole
--    journal (4.3 ms at 40,000 entries, growing with every request's history; 0.05 ms with it). Also
--    used when a share is deleted with its request (`ON DELETE SET NULL`).
--  * `notifications (recipient_id) WHERE read_at IS NULL`: the bell's unread count, read every minute
--    by every open page, scanned every notification of its recipient, read ones included (4.6 ms for
--    10,000); partial, it holds the unread ones only (not in schema.prisma: Prisma cannot express a
--    partial index).
--
-- Plain `CREATE INDEX` (Prisma runs the file in one transaction, where `CONCURRENTLY` is refused):
-- writes to the two tables wait while each index is built, a fraction of a second at these volumes.
-- `IF NOT EXISTS`: the file can run again on a partly migrated database.

CREATE INDEX IF NOT EXISTS "audit_log_share_link_id_idx" ON "audit_log"("share_link_id");

CREATE INDEX IF NOT EXISTS "notifications_unread_recipient_id_idx" ON "notifications"("recipient_id") WHERE "read_at" IS NULL;
