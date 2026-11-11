-- ROADMAP E07.01: the cycle of nominative shares — invitation, recipient, level, list of accesses,
-- revocation by the owner or an administrator.
--
--  * `audit_action` gains `share_link_level_changed`: the owner changes the level of an active share
--    (the recipient keeps the same link), journaled with the level before and after.
--  * `share_links.access_level` only takes the three levels of @confluent/shared
--    `access-level.schema.ts` (CHECK).
--
-- Backfill: a level outside the three was already read as `public` (`grantedLevel`, closed by
-- default), so it is written `public`: what its recipient reads does not change. No other row is
-- touched. Not undone: the revert keeps `public`, which reads the same.
--
-- Deployment resume: Prisma runs this file as one transaction; each statement can also run again on
-- a partly migrated database (IF NOT EXISTS, constraint dropped before being added), so any prefix of
-- this file, then the whole file, gives the same database (test/pg/share-links.pg-spec.ts). Undone by
-- prisma/checks/20261123000000_share_links.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'share_link_level_changed';

UPDATE "share_links" SET "access_level" = 'public'
WHERE "access_level" NOT IN ('public', 'partiel', 'complet');

ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_access_level_check";

ALTER TABLE "share_links" ADD CONSTRAINT "share_links_access_level_check"
  CHECK ("access_level" IN ('public', 'partiel', 'complet'));
