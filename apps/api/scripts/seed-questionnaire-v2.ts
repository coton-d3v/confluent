import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import type { field_type } from '@prisma/client'
import { refuseInProduction } from './lib/environment-guard'
import {
  createVersionStructure,
  labelsToChoices,
} from '../src/modules/questionnaires/questionnaire-structure'

const prisma = new PrismaClient()

interface FieldDef {
  section: string
  // Technical key read by the classification rules (table classification_rules) — never rename.
  key?: string
  label: string
  fieldType: field_type
  options: string[]
  required: boolean
  orderIndex: number
}

// Share level required to read each section (decision 2026-11-08, story 12.1); default `complet`.
const SECTION_ACCESS_LEVEL: Record<string, 'public' | 'partiel' | 'complet'> = {
  'Identité du projet': 'public',
  'Ancrage régional': 'partiel',
  'Origine & technologie': 'partiel',
  'Stade spécifique': 'partiel',
  'Stade financier': 'complet',
}
const withAccessLevel = ({ options, ...f }: FieldDef) => ({
  ...f,
  choices: labelsToChoices(options),
  minAccessLevel: SECTION_ACCESS_LEVEL[f.section] ?? 'complet',
})

const FIELDS: FieldDef[] = [
  // ── Bloc 0 — Ancrage régional ─────────────────────────────────────────────
  {
    section: 'Ancrage régional',
    key: 'ancrage_cvl',
    label: 'Votre lien avec la région Centre Val de Loire',
    fieldType: 'select',
    options: [
      'Mon projet est basé en CVL',
      "Je cherche à m'y installer",
      "Je découvre l'écosystème",
    ],
    required: false,
    orderIndex: 0,
  },

  // ── Bloc 1 — Identité du projet ───────────────────────────────────────────
  {
    section: 'Identité du projet',
    label: "Nom du projet ou de l'entreprise",
    fieldType: 'text',
    options: [],
    required: true,
    orderIndex: 0,
  },
  {
    section: 'Identité du projet',
    key: 'secteur',
    label: 'Secteur principal',
    fieldType: 'select',
    options: [
      // Deeptech
      'biotech',
      'medtech',
      'chimie verte',
      'énergie',
      'spatial',
      'matériaux avancés',
      'quantique',
      'photonique',
      'nucléaire',
      // Tech
      'SaaS',
      'marketplace',
      'fintech',
      'edtech',
      'legaltech',
      'proptech',
      'insurtech',
      'HRtech',
      'agritech numérique',
      'healthtech numérique',
      'mobility tech',
      'logistique tech',
      'cleantech numérique',
      'food tech numérique',
      'cybersécurité',
      'IA-ML',
      'IoT',
      'gaming',
      'govtech',
      'retail tech',
      'media tech',
      'sports tech',
      // Non-tech
      'commerce',
      'restauration',
      'service à la personne',
      'immobilier',
      'artisanat',
      'ESS non-tech',
    ],
    required: true,
    orderIndex: 1,
  },
  {
    section: 'Identité du projet',
    label: 'Quel problème résolvez-vous ?',
    fieldType: 'textarea',
    options: [],
    required: true,
    orderIndex: 2,
  },
  {
    section: 'Identité du projet',
    label: 'Qui est votre cible client principale ?',
    fieldType: 'text',
    options: [],
    required: true,
    orderIndex: 3,
  },
  {
    section: 'Identité du projet',
    label: 'Quelle est votre solution en quelques mots ?',
    fieldType: 'textarea',
    options: [],
    required: true,
    orderIndex: 4,
  },
  {
    section: 'Identité du projet',
    label: 'Modèle de vente',
    fieldType: 'select',
    options: ['B2B', 'B2C', 'B2B2C', 'C2C', 'Mixte', 'Autre'],
    required: true,
    orderIndex: 5,
  },
  {
    section: 'Identité du projet',
    label: "Taille de l'équipe fondatrice",
    fieldType: 'select',
    options: ['Solo', 'Duo', '3 fondateurs et plus'],
    required: true,
    orderIndex: 6,
  },
  {
    section: 'Identité du projet',
    key: 'structure_juridique',
    label: 'Avez-vous une structure juridique créée ?',
    fieldType: 'select',
    options: ['Non', 'En cours de création', 'Oui'],
    required: true,
    orderIndex: 7,
  },

  // ── Bloc 2 — Stade financier ──────────────────────────────────────────────
  {
    section: 'Stade financier',
    key: 'stade_financement',
    label: 'Stade de financement actuel',
    fieldType: 'select',
    options: [
      'Fonds propres uniquement',
      "Love money – subventions – prêts d'honneur",
      'Seed – investisseurs professionnels',
      'Pré-Série A ou au-delà',
    ],
    required: true,
    orderIndex: 0,
  },

  // ── Bloc 3 — Origine & technologie ───────────────────────────────────────
  {
    section: 'Origine & technologie',
    key: 'origine_projet',
    label: 'Origine du projet',
    fieldType: 'select',
    options: [
      'Projet créé ex nihilo',
      "Spin-off d'une entreprise",
      "Spin-off d'un laboratoire / recherche publique",
      "Reprise d'entreprise existante",
      "Pivot d'une activité existante (> 5 ans)",
    ],
    required: true,
    orderIndex: 0,
  },
  {
    section: 'Origine & technologie',
    key: 'techno_difficile',
    label: 'Votre projet repose-t-il sur une technologie difficile à reproduire ?',
    fieldType: 'select',
    options: [
      'Oui, clairement',
      'Partiellement – en développement',
      "Non – c'est avant tout un modèle ou un service",
    ],
    required: true,
    orderIndex: 1,
  },
  {
    section: 'Origine & technologie',
    key: 'brevets',
    label: 'Avez-vous des brevets ?',
    fieldType: 'select',
    options: ['Oui déposés', 'En cours', 'Non'],
    required: false,
    orderIndex: 2,
  },
  {
    section: 'Origine & technologie',
    key: 'verrou_scientifique',
    label: 'Y a-t-il un verrou scientifique non résolu ?',
    fieldType: 'select',
    options: ['Oui', 'Non'],
    required: false,
    orderIndex: 3,
  },
  {
    section: 'Origine & technologie',
    key: 'rd_public',
    label: 'Financement R&D public (ANR, BPI, Horizon) ?',
    fieldType: 'select',
    options: ['Oui', 'En cours', 'Non'],
    required: false,
    orderIndex: 4,
  },

  // ── Bloc 4 — Stade spécifique ─────────────────────────────────────────────
  {
    section: 'Stade spécifique',
    key: 'stade_projet',
    label: 'Stade du projet',
    fieldType: 'select',
    options: [
      'Idée',
      'Concept validé',
      'MVP',
      'Premiers clients',
      'Croissance',
      'TRL 1-3 Recherche fondamentale',
      'TRL 4-6 Développement',
      'TRL 7-9 Déploiement',
    ],
    required: true,
    orderIndex: 0,
  },
  {
    section: 'Stade spécifique',
    label: 'Clients actifs ?',
    fieldType: 'select',
    options: ['Oui payants', 'Oui en test gratuit', 'Non'],
    required: false,
    orderIndex: 1,
  },
  {
    section: 'Stade spécifique',
    label: 'Horizon estimé avant commercialisation',
    fieldType: 'select',
    options: ['Moins de 2 ans', '2 à 5 ans', 'Plus de 5 ans'],
    required: false,
    orderIndex: 2,
  },
]

const DOSSIER_FORM = { slug: 'profil-entreprise', name: "Profil de l'entreprise", usage: 'dossier' }

async function main() {
  const form = await prisma.questionnaire.upsert({
    where: { slug: DOSSIER_FORM.slug },
    update: {},
    create: DOSSIER_FORM,
  })
  const existing = await prisma.questionnaireVersion.findUnique({
    where: { questionnaireId_version: { questionnaireId: form.id, version: 2 } },
  })
  if (existing) {
    // Recreating the fields would orphan (or, through the FK, block on) every V2 answer: allowed in
    // development only, where the demo data can be rebuilt.
    refuseInProduction('Recréation des champs de la V2 existante')
    const answers = await prisma.dossierAnswer.count({
      where: { field: { versionId: existing.id } },
    })
    if (answers > 0) {
      console.error(`✗ La V2 a déjà ${answers} réponses : ses champs ne sont pas recréés.`)
      process.exit(1)
    }
  }

  // Archiving the published version and publishing V2 happen together, or not at all: a failure can
  // never leave the platform without a published questionnaire.
  const version = await prisma.$transaction(async (tx) => {
    await tx.questionnaireVersion.updateMany({
      where: { questionnaireId: form.id, status: 'published' },
      data: { status: 'archived' },
    })
    const v2 = existing
      ? await tx.questionnaireVersion.update({
          where: { id: existing.id },
          data: { status: 'published', publishedAt: new Date() },
        })
      : await tx.questionnaireVersion.create({
          data: {
            questionnaireId: form.id,
            version: 2,
            status: 'published',
            publishedAt: new Date(),
          },
        })
    if (existing) await tx.questionnaireSection.deleteMany({ where: { versionId: v2.id } })
    await createVersionStructure(tx, v2.id, FIELDS.map(withAccessLevel))
    return v2
  })

  console.log(
    `✓ Questionnaire V2 ${existing ? 'republié' : 'publié'} — ${FIELDS.length} champs (id: ${version.id})`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
