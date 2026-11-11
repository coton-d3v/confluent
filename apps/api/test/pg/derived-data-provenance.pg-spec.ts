import { randomUUID } from 'node:crypto'
import { SITE_ORIGIN } from '../../src/modules/audit/action-origin'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ClassificationService } from '../../src/modules/classification/classification.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { companyOf, testDatabase } from './database'

// Code review R31 (recontrôle): a sector computed from a confidential field, then the rules are
// changed to read a public field — without reclassifying. A public share must still not see the
// value computed from the confidential field.
describe('derived data and rule changes (PostgreSQL)', () => {
  const prisma = testDatabase()
  const classification = new ClassificationService(prisma)
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    classification,
    new AuditService(prisma),
    new CompaniesService(prisma),
  )
  afterAll(() => prisma.$disconnect())

  it('a rule change without reclassification never reveals a confidential source', async () => {
    const tag = randomUUID().slice(0, 8)
    const user = await prisma.user.create({
      data: { email: `r31-${tag}@test.local`, role: 'entrepreneur' },
    })
    const form = await prisma.questionnaire.create({
      data: { name: `R31 ${tag}`, slug: `r31-${tag}` },
    })
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published', publishedAt: new Date() },
    })
    const section = await prisma.questionnaireSection.create({
      data: { versionId: version.id, key: 'projet', title: 'Projet', orderIndex: 0 },
    })
    const field = (key: string, minAccessLevel: string, orderIndex: number) =>
      prisma.questionnaireField.create({
        data: {
          versionId: version.id,
          sectionId: section.id,
          key,
          label: key,
          fieldType: 'text',
          minAccessLevel,
          orderIndex,
        },
      })
    const privateKey = `secteur_prive_${tag}`
    const publicKey = `secteur_public_${tag}`
    const confidential = await field(privateKey, 'complet', 0)
    const open = await field(publicKey, 'public', 1)
    const dossier = await prisma.dossier.create({
      data: {
        userId: user.id,
        companyId: await companyOf(prisma, user.id),
        name: 'R31',
        slug: `r31-${tag}`,
        questionnaireVersionId: version.id,
      },
    })
    await prisma.dossierAnswer.createMany({
      data: [
        { dossierId: dossier.id, fieldId: confidential.id, value: 'Secret' },
        { dossierId: dossier.id, fieldId: open.id, value: 'Public' },
      ],
    })
    // Only this test's rules for the sector: the others are set aside for the duration.
    const others = await prisma.classificationRule.findMany({ where: { dimension: 'sector' } })
    await prisma.classificationRule.deleteMany({ where: { dimension: 'sector' } })
    try {
      const rule = await prisma.classificationRule.create({
        data: { dimension: 'sector', fieldKey: privateKey },
      })
      await dossiers.submit(dossier.id, user.id, SITE_ORIGIN)
      const submitted = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })
      expect(submitted.sector).toBe('Secret')

      // The rule now reads the public field; the dossier is not reclassified.
      await prisma.classificationRule.update({
        where: { id: rule.id },
        data: { fieldKey: publicKey },
      })
      expect((await dossiers.projectForLevel(submitted, 'public')).sector).toBeNull()
      expect((await dossiers.projectForLevel(submitted, 'complet')).sector).toBe('Secret')
    } finally {
      await prisma.classificationRule.deleteMany({ where: { dimension: 'sector' } })
      await prisma.classificationRule.createMany({
        data: others.map(({ dimension, fieldKey, choiceKey, value, position }) => ({
          dimension,
          fieldKey,
          choiceKey,
          value,
          position,
        })),
      })
    }
  })
})
