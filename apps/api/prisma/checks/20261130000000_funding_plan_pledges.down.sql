-- Reverts migration 20261130000000_funding_plan_pledges (ROADMAP E06.04) before the application is
-- rolled back to E07.10. Lost on the way back: which plan lines confirm which pledges — the lines
-- themselves, their amounts and states stay, and so do the pledges; the earlier application then
-- shows the plan's lines and, apart, the pledges, as before E06.04. The journal entries of these
-- confirmations (`funding_plan_updated`, `change` `pledge_confirmed` / `pledge_released`, owner's
-- side) stay: the earlier application reads only the structure's side of that action. To be run
-- FIRST, before the reverts of E07.08 and of the earlier migrations (those of E07.06 and E06.03 drop
-- what this table references).
--
-- Without any confirmation, nothing is lost. One would be — the owner's statement that a pledge
-- became financing, which they would have to make again —, so the revert refuses unless the operator
-- accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_funding_plan_pledges_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261130000000_funding_plan_pledges';
-- Exercised by test/pg/funding-plan-pledges.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF coalesce(current_setting('confluent.accept_funding_plan_pledges_loss', true), '') <> 'on' THEN
    IF to_regclass('funding_plan_pledge_links') IS NOT NULL THEN
      EXECUTE 'SELECT "line_id" FROM "funding_plan_pledge_links" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'pledges confirmed in financing plans exist (line %): they would be lost; SET LOCAL confluent.accept_funding_plan_pledges_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "funding_plan_pledge_links";

DROP INDEX IF EXISTS "investor_pledges_id_dossier_id_key";

DROP INDEX IF EXISTS "candidatures_id_dossier_id_key";

DROP INDEX IF EXISTS "funding_plan_lines_id_candidature_id_key";
