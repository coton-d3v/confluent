-- ROADMAP E03.12: classification rules become data, edited by administrators. The initial rows
-- reproduce exactly the rules previously written in classification.rules.ts: no dossier changes.

CREATE TABLE "classification_rules" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "dimension" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "choice_key" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classification_rules_dimension_check" CHECK ("dimension" IN ('sector', 'maturity_stage', 'ancrage_cvl', 'axe1_projet', 'axe2_financier', 'axe3_origine', 'pre_creation', 'non_tech', 'deeptech_signal'))
);

CREATE UNIQUE INDEX "classification_rules_dimension_field_key_choice_key_key"
  ON "classification_rules"("dimension", "field_key", "choice_key");

INSERT INTO "classification_rules" ("dimension", "field_key", "choice_key", "value", "position") VALUES
  ('sector', 'secteur', '', '', 0),
  ('sector', 'secteur_activite', '', '', 1),
  ('maturity_stage', 'stade_projet', '', '', 0),
  ('maturity_stage', 'stade_maturite', '', '', 1),
  ('ancrage_cvl', 'ancrage_cvl', 'mon_projet_est_base_en_cvl', 'ancré', 0),
  ('ancrage_cvl', 'ancrage_cvl', 'je_cherche_a_m_y_installer', 'en_cours', 0),
  ('ancrage_cvl', 'ancrage_cvl', 'je_decouvre_l_ecosysteme', 'découverte', 0),
  ('axe1_projet', 'stade_projet', 'idee', '1', 0),
  ('axe1_projet', 'stade_projet', 'concept_valide', '2', 0),
  ('axe1_projet', 'stade_projet', 'mvp', '3', 0),
  ('axe1_projet', 'stade_projet', 'premiers_clients', '4', 0),
  ('axe1_projet', 'stade_projet', 'croissance', '5', 0),
  ('axe1_projet', 'stade_projet', 'trl_1_3_recherche_fondamentale', '1', 0),
  ('axe1_projet', 'stade_projet', 'trl_4_6_developpement', '3', 0),
  ('axe1_projet', 'stade_projet', 'trl_7_9_deploiement', '5', 0),
  ('axe2_financier', 'stade_financement', 'fonds_propres_uniquement', '2', 0),
  ('axe2_financier', 'stade_financement', 'love_money_subventions_prets_d_honneur', '3', 0),
  ('axe2_financier', 'stade_financement', 'seed_investisseurs_professionnels', '4', 0),
  ('axe2_financier', 'stade_financement', 'pre_serie_a_ou_au_dela', '5', 0),
  ('axe3_origine', 'origine_projet', 'projet_cree_ex_nihilo', '1', 0),
  ('axe3_origine', 'origine_projet', 'spin_off_d_une_entreprise', '2', 0),
  ('axe3_origine', 'origine_projet', 'spin_off_d_un_laboratoire_recherche_publique', '3', 0),
  ('axe3_origine', 'origine_projet', 'reprise_d_entreprise_existante', '4', 0),
  ('axe3_origine', 'origine_projet', 'pivot_d_une_activite_existante_5_ans', '5', 0),
  ('pre_creation', 'structure_juridique', 'non', 'true', 0),
  ('pre_creation', 'structure_juridique', 'en_cours_de_creation', 'true', 0),
  ('pre_creation', 'structure_juridique', 'oui', 'false', 0),
  ('non_tech', 'techno_difficile', 'non_c_est_avant_tout_un_modele_ou_un_service', '', 0),
  ('deeptech_signal', 'origine_projet', 'spin_off_d_un_laboratoire_recherche_publique', '', 0),
  ('deeptech_signal', 'brevets', 'oui_deposes', '', 0),
  ('deeptech_signal', 'brevets', 'en_cours', '', 0),
  ('deeptech_signal', 'verrou_scientifique', 'oui', '', 0),
  ('deeptech_signal', 'rd_public', 'oui', '', 0),
  ('deeptech_signal', 'rd_public', 'en_cours', '', 0);

-- Defaults only served the initial rows; the application provides id and updated_at.
ALTER TABLE "classification_rules" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "classification_rules" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TYPE "audit_action" ADD VALUE 'classification_rules_updated';
