// Technical keys (`questionnaire_fields.key`) read by the classification. A label can be edited
// freely in the builder; the key cannot. Keep in sync with the seeds and the backfill migration
// 20261029000000_add_questionnaire_field_key.
export const CLASSIFICATION_KEYS = {
  // V1
  secteurActivite: 'secteur_activite',
  stadeMaturite: 'stade_maturite',
  // V2
  ancrage: 'ancrage_cvl',
  secteur: 'secteur',
  structure: 'structure_juridique',
  financement: 'stade_financement',
  origine: 'origine_projet',
  techno: 'techno_difficile',
  brevets: 'brevets',
  verrou: 'verrou_scientifique',
  rdPublic: 'rd_public',
  stade: 'stade_projet',
} as const

export type ClassificationKey = (typeof CLASSIFICATION_KEYS)[keyof typeof CLASSIFICATION_KEYS]
