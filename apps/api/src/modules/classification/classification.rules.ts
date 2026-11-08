import { CLASSIFICATION_KEYS as K } from './classification.keys'

// Classification rules, matched on choice keys (E03.06): a choice label can be reworded in the
// builder without changing the classification. E03.12 makes this taxonomy configurable.

export interface ClassificationResult {
  sector: string | null
  maturityStage: string | null
  ancrageCvl: string | null
  tagTechnologique: string | null
  axe1Projet: number | null
  axe2Financier: number | null
  axe3Origine: number | null
  deeptechScore: number | null
  preCreation: boolean | null
}

export const EMPTY_CLASSIFICATION: ClassificationResult = {
  sector: null,
  maturityStage: null,
  ancrageCvl: null,
  tagTechnologique: null,
  axe1Projet: null,
  axe2Financier: null,
  axe3Origine: null,
  deeptechScore: null,
  preCreation: null,
}

// An answer as the rules see it: the stored value (a choice key for a list) and what it displays.
export interface ClassifiedAnswer {
  value: string
  label: string
}

const ANCRAGE: Record<string, string> = {
  mon_projet_est_base_en_cvl: 'ancré',
  je_cherche_a_m_y_installer: 'en_cours',
  je_decouvre_l_ecosysteme: 'découverte',
}

const AXE1_STADE: Record<string, number> = {
  idee: 1,
  concept_valide: 2,
  mvp: 3,
  premiers_clients: 4,
  croissance: 5,
  trl_1_3_recherche_fondamentale: 1,
  trl_4_6_developpement: 3,
  trl_7_9_deploiement: 5,
}

const AXE2_FINANCEMENT: Record<string, number> = {
  fonds_propres_uniquement: 2,
  love_money_subventions_prets_d_honneur: 3,
  seed_investisseurs_professionnels: 4,
  pre_serie_a_ou_au_dela: 5,
}

const AXE3_ORIGINE: Record<string, number> = {
  projet_cree_ex_nihilo: 1,
  spin_off_d_une_entreprise: 2,
  spin_off_d_un_laboratoire_recherche_publique: 3,
  reprise_d_entreprise_existante: 4,
  pivot_d_une_activite_existante_5_ans: 5,
}

const PRE_CREATION: Record<string, boolean> = {
  non: true,
  en_cours_de_creation: true,
  oui: false,
}

const NON_TECH = 'non_c_est_avant_tout_un_modele_ou_un_service'
const DEEPTECH_SIGNALS: Record<string, readonly string[]> = {
  [K.origine]: ['spin_off_d_un_laboratoire_recherche_publique'],
  [K.brevets]: ['oui_deposes', 'en_cours'],
  [K.verrou]: ['oui'],
  [K.rdPublic]: ['oui', 'en_cours'],
}

// `onUnmapped` reports an answer the rules do not know (e.g. a choice added in the builder), so
// that it is surfaced instead of silently ignored.
export function classifyAnswers(
  answers: ReadonlyMap<string, ClassifiedAnswer>,
  onUnmapped: (fieldKey: string, value: string) => void = () => undefined,
): ClassificationResult {
  const value = (fieldKey: string) => answers.get(fieldKey)?.value ?? null
  const lookup = <T>(fieldKey: string, table: Record<string, T>): T | null => {
    const v = value(fieldKey)
    if (v == null) return null
    if (Object.hasOwn(table, v)) return table[v]
    onUnmapped(fieldKey, v)
    return null
  }

  const techno = value(K.techno)
  let tagTechnologique: string | null = null
  let deeptechScore: number | null = null
  if (techno != null) {
    if (techno === NON_TECH) {
      tagTechnologique = 'non_tech'
      deeptechScore = 0
    } else {
      deeptechScore = Object.entries(DEEPTECH_SIGNALS).filter(([fieldKey, keys]) =>
        keys.includes(value(fieldKey) ?? ''),
      ).length
      tagTechnologique = deeptechScore >= 2 ? 'deeptech' : 'tech'
    }
  }

  // Sector and stage are displayed as is: keep the label, not the key (V1 fields are free text).
  const label = (fieldKey: string) => answers.get(fieldKey)?.label ?? null
  return {
    sector: label(K.secteur) ?? label(K.secteurActivite),
    maturityStage: label(K.stade) ?? label(K.stadeMaturite),
    ancrageCvl: lookup(K.ancrage, ANCRAGE),
    tagTechnologique,
    axe1Projet: lookup(K.stade, AXE1_STADE),
    axe2Financier: lookup(K.financement, AXE2_FINANCEMENT),
    axe3Origine: lookup(K.origine, AXE3_ORIGINE),
    deeptechScore,
    preCreation: lookup(K.structure, PRE_CREATION),
  }
}
