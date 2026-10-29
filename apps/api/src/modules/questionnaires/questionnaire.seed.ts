import type { field_type } from '@prisma/client'

export interface SeedField {
  section: string
  key?: string
  label: string
  fieldType: field_type
  required: boolean
  orderIndex: number
}

export const QUESTIONNAIRE_V1_FIELDS: SeedField[] = [
  // Section 1 — Présentation (4 fields)
  {
    section: 'Présentation',
    label: "Nom de l'entreprise",
    fieldType: 'text',
    required: true,
    orderIndex: 0,
  },
  {
    section: 'Présentation',
    key: 'secteur_activite',
    label: "Secteur d'activité",
    fieldType: 'select',
    required: true,
    orderIndex: 1,
  },
  {
    section: 'Présentation',
    key: 'stade_maturite',
    label: 'Stade de maturité',
    fieldType: 'select',
    required: true,
    orderIndex: 2,
  },
  {
    section: 'Présentation',
    label: 'Pitch court',
    fieldType: 'textarea',
    required: true,
    orderIndex: 3,
  },
  // Section 2 — Marché & produit (4 fields)
  {
    section: 'Marché & produit',
    label: 'Marché cible',
    fieldType: 'textarea',
    required: true,
    orderIndex: 0,
  },
  {
    section: 'Marché & produit',
    label: 'Proposition de valeur',
    fieldType: 'textarea',
    required: true,
    orderIndex: 1,
  },
  {
    section: 'Marché & produit',
    label: 'Taille du marché (k€)',
    fieldType: 'number',
    required: false,
    orderIndex: 2,
  },
  {
    section: 'Marché & produit',
    label: 'Concurrents principaux',
    fieldType: 'textarea',
    required: false,
    orderIndex: 3,
  },
  // Section 3 — Finances & équipe (4 fields)
  {
    section: 'Finances & équipe',
    label: 'Chiffre d’affaires (k€)',
    fieldType: 'number',
    required: false,
    orderIndex: 0,
  },
  {
    section: 'Finances & équipe',
    label: 'Effectif',
    fieldType: 'number',
    required: true,
    orderIndex: 1,
  },
  {
    section: 'Finances & équipe',
    label: 'Levée en cours (k€)',
    fieldType: 'number',
    required: false,
    orderIndex: 2,
  },
  {
    section: 'Finances & équipe',
    label: 'Usage des fonds',
    fieldType: 'textarea',
    required: false,
    orderIndex: 3,
  },
]
