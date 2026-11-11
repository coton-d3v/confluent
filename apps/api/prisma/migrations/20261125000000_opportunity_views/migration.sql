-- ROADMAP E07.03: an investor's opportunities — the requests shared with them directly (E07.01) and
-- those listed in the pools of the workspaces where they are an active investor (E07.02). Read from
-- the existing tables; nothing is stored about them but each reading of one, journaled once as
-- `opportunity_viewed` (who, which request, at which level, through which share and pools), for the
-- measures to come (E07.08). Hidden from the request's owner, like the pools' investors themselves
-- (D05); a reading through a direct share also counts as a view of that share.
--
-- Backfill: none — no opportunity was ever read. Deployment resume: one idempotent statement.
-- Undone by prisma/checks/20261125000000_opportunity_views.down.sql.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'opportunity_viewed';
