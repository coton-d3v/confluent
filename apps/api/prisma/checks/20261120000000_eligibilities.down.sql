-- Reverts migration 20261120000000_eligibilities (ROADMAP E06.05) before the application is rolled
-- back to E06.03. Lost on the way back: the schemes of every workspace, the eligibilities of every
-- candidature and the journal entries of their changes; the values added to `audit_action` stay
-- (PostgreSQL cannot remove them; unused). To be run BEFORE the reverts of E06.03 and E06.02: the
-- eligibilities' foreign key uses E06.03's unique index on `candidatures (id, workspace_id)`.
--
-- A workspace that kept the default schemes, without any eligibility, loses nothing a new run of the
-- migration does not give back. Eligibilities declared by entrepreneurs or conseillers, and schemes a
-- workspace configured — renamed, described, reordered, deactivated or added —, would be lost, so the
-- revert refuses unless the operator accepts it explicitly for this transaction:
--   SET LOCAL confluent.accept_eligibilities_loss = 'on';
-- Run in one transaction (psql --single-transaction), then remove the migration's row so it can be
-- applied again:
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261120000000_eligibilities';
-- Exercised by test/pg/eligibilities.pg-spec.ts (revert, then apply the migration again).

DO $$
DECLARE
  found TEXT;
BEGIN
  IF to_regclass('eligibility_schemes') IS NOT NULL
     AND coalesce(current_setting('confluent.accept_eligibilities_loss', true), '') <> 'on' THEN
    IF to_regclass('candidature_eligibilities') IS NOT NULL THEN
      EXECUTE 'SELECT "candidature_id" FROM "candidature_eligibilities" LIMIT 1' INTO found;
      IF found IS NOT NULL THEN
        RAISE EXCEPTION 'eligibilities exist (candidature %): they would be lost; SET LOCAL confluent.accept_eligibilities_loss = ''on'' to revert all the same', found;
      END IF;
    END IF;
    EXECUTE $q$
      SELECT s."workspace_id"
      FROM "eligibility_schemes" s
      LEFT JOIN (VALUES
        ('jeir', 'JEIR', 'Jeune entreprise innovante de rupture (statut fiscal de l’entreprise).', 0),
        ('jei', 'JEI', 'Jeune entreprise innovante (statut fiscal de l’entreprise).', 1),
        ('cir', 'CIR', 'Crédit d’impôt recherche, au titre des dépenses de recherche de l’entreprise.', 2),
        ('cii', 'CII', 'Crédit d’impôt innovation, au titre des dépenses d’innovation d’une PME.', 3),
        ('ir_pme', 'IR-PME', 'Réduction d’impôt sur le revenu des personnes qui souscrivent au capital de la PME (dite « Madelin »).', 4)
      ) AS d("key", "label", "description", "position")
        ON d."key" = s."key" AND d."label" = s."label" AND d."description" = s."description" AND d."position" = s."position"
      WHERE d."key" IS NULL OR NOT s."active"
      LIMIT 1
    $q$ INTO found;
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'configured eligibility schemes exist (workspace %): they would be lost; SET LOCAL confluent.accept_eligibilities_loss = ''on'' to revert all the same', found;
    END IF;
  END IF;
END $$;

DELETE FROM "audit_log" WHERE "action_type" IN ('eligibility_schemes_updated', 'candidature_eligibility_updated');

DROP TABLE IF EXISTS "candidature_eligibilities";

DROP TABLE IF EXISTS "eligibility_schemes";
