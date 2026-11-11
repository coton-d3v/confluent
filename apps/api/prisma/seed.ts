import { PrismaClient, type Prisma, type user_role } from '@prisma/client'
import { QUESTIONNAIRE_V1_FIELDS } from '../src/modules/questionnaires/questionnaire.seed'
import { createVersionStructure } from '../src/modules/questionnaires/questionnaire-structure'

// Same identity as DOSSIER_FORM in questionnaires.service.ts (kept local: no Nest import in seeds).
const DOSSIER_FORM = { slug: 'profil-entreprise', name: "Profil de l'entreprise", usage: 'dossier' }
import { refuseInProduction } from '../scripts/lib/environment-guard'

refuseInProduction('Seed de démonstration (comptes @localhost.dev, dossier Biosensio)')

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────────────────────────
// Dev/preprod fixtures — stable, idempotent.
// The `@localhost.dev` namespace is RESERVED for seeded accounts. Do not reuse.
// ─────────────────────────────────────────────────────────────────────────────

const SEED_USERS: ReadonlyArray<{ email: string; role: user_role }> = [
  { email: 'entrepreneur@localhost.dev', role: 'entrepreneur' },
  { email: 'financeur@localhost.dev', role: 'financeur' },
  { email: 'admin@localhost.dev', role: 'admin' },
]

// Stable share token so tests can reach /v1/shares/:token without env plumbing.
const SEED_SHARE_TOKEN = '11111111-2222-4333-a555-666666666666'

// Answers for the Biosensio dossier — keyed by field label (resolved at runtime
// via the published questionnaire). A field not found in the running questionnaire
// is simply skipped (forward-compat with schema evolutions).
const BIOSENSIO_ANSWERS: Record<string, string> = {
  "Nom de l'entreprise": 'Biosensio',
  "Secteur d'activité": 'Biotech',
  'Stade de maturité': 'Seed',
  'Pitch court': 'Plateforme de biocapteurs connectés pour le monitoring agricole en temps réel.',
  'Marché cible': 'PME agricoles et coopératives en Centre-Val de Loire, marché européen EUR 2.1B.',
  'Proposition de valeur':
    'Réduction de 30% de l’usage de phytosanitaires via des capteurs IoT auto-calibrés.',
  'Taille du marché (k€)': '2100',
  'Concurrents principaux':
    'Semios (US), Connecterra (NL), CropX (IL). Différenciation : calibration sans intervention.',
  'Chiffre d’affaires (k€)': '120',
  Effectif: '8',
  'Levée en cours (k€)': '1500',
  'Usage des fonds': 'Industrialisation du capteur v2, expansion commerciale France + Benelux.',
}

async function main(): Promise<void> {
  // 1) Dossier form + questionnaire v1 — idempotent.
  await prisma.$transaction(async (tx) => {
    const form = await tx.questionnaire.upsert({
      where: { slug: DOSSIER_FORM.slug },
      update: {},
      create: DOSSIER_FORM,
    })
    const existing = await tx.questionnaireVersion.findUnique({
      where: { questionnaireId_version: { questionnaireId: form.id, version: 1 } },
    })
    if (existing) {
      console.log(`[seed] questionnaire v1 already exists — skipping`)
      return
    }
    const hasPublished = await tx.questionnaireVersion.count({
      where: { questionnaireId: form.id, status: 'published' },
    })
    const version = await tx.questionnaireVersion.create({
      data: {
        questionnaireId: form.id,
        version: 1,
        status: hasPublished ? 'archived' : 'published',
        publishedAt: new Date(),
      },
    })
    await createVersionStructure(tx, version.id, QUESTIONNAIRE_V1_FIELDS)
    console.log(`[seed] questionnaire v1: inserted ${QUESTIONNAIRE_V1_FIELDS.length} fields`)
  })

  // 2) Fixtures users — upsert by email.
  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, isActive: true },
      create: { email: u.email, role: u.role, isActive: true },
    })
    console.log(`[seed] user: ${user.email} (${user.role})`)
  }

  // 3) Optional extra admin — opt-in via SEED_ADMIN_EMAIL.
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  if (adminEmail) {
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: 'admin', isActive: true },
      create: { email: adminEmail, role: 'admin', isActive: true },
    })
    console.log(`[seed] extra admin: ${admin.email} (id=${admin.id})`)
  }

  // 4) Coherent business data tied to the entrepreneur fixture.
  const entrepreneur = await prisma.user.findUniqueOrThrow({
    where: { email: 'entrepreneur@localhost.dev' },
  })
  const financeur = await prisma.user.findUniqueOrThrow({
    where: { email: 'financeur@localhost.dev' },
  })
  const activeVersion = await prisma.questionnaireVersion.findFirstOrThrow({
    where: { status: 'published', questionnaire: { usage: DOSSIER_FORM.usage } },
    include: { fields: true },
    orderBy: { version: 'desc' },
  })

  // A dossier comes with its own company, named after it, whose profile answers the dossier's form
  // version (E05.04, E05.05); an existing one is kept as is.
  const seedDossier = async (
    data: Omit<Prisma.DossierUncheckedCreateInput, 'userId' | 'companyId'> & { slug: string },
  ) => {
    const existing = await prisma.dossier.findUnique({ where: { slug: data.slug } })
    if (existing) return existing
    return prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          ownerId: entrepreneur.id,
          name: data.name,
          profileVersionId: data.questionnaireVersionId,
        },
      })
      return tx.dossier.create({
        data: { ...data, userId: entrepreneur.id, companyId: company.id },
      })
    })
  }

  // 4.a) Submitted dossier with answers + classification.
  const biosensio = await seedDossier({
    name: 'Biosensio',
    slug: 'biosensio',
    questionnaireVersionId: activeVersion.id,
    sector: 'Biotech',
    maturityStage: 'Seed',
    submittedAt: new Date('2026-03-15T10:00:00.000Z'),
  })
  const biosensioAnswerCount = await prisma.dossierAnswer.count({
    where: { companyId: biosensio.companyId },
  })
  if (biosensioAnswerCount === 0) {
    const answersData = activeVersion.fields
      .filter((f) => BIOSENSIO_ANSWERS[f.label] !== undefined)
      .map((f) => ({
        companyId: biosensio.companyId,
        fieldId: f.id,
        value: BIOSENSIO_ANSWERS[f.label],
      }))
    await prisma.dossierAnswer.createMany({ data: answersData })
    console.log(`[seed] dossier "${biosensio.slug}": ${answersData.length} answers`)
  } else {
    console.log(
      `[seed] dossier "${biosensio.slug}": already has ${biosensioAnswerCount} answers — skipping`,
    )
  }

  // 4.b) Draft dossier — no answers, not submitted yet (useful for "empty state" UI tests).
  await seedDossier({
    name: 'Agrotech Innovations',
    slug: 'agrotech-innovations',
    questionnaireVersionId: activeVersion.id,
  })
  console.log('[seed] dossier "agrotech-innovations" (draft)')

  // 5) Share link — financeur has active access to Biosensio via a stable token.
  const share = await prisma.shareLink.upsert({
    where: { token: SEED_SHARE_TOKEN },
    update: { status: 'active', revokedAt: null },
    create: {
      dossierId: biosensio.id,
      recipientEmail: financeur.email,
      token: SEED_SHARE_TOKEN,
      status: 'active',
    },
  })
  console.log(`[seed] share link: ${share.token} → ${share.recipientEmail} (${share.status})`)

  console.log('[seed] done')
}

main()
  .catch((err: unknown) => {
    console.error('[seed] error', err)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
