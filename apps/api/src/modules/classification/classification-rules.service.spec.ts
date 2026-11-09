import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { createVersionStructure, labelsToChoices } from '../questionnaires/questionnaire-structure'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { DEFAULT_CLASSIFICATION_RULES } from '../../testing/classification-rules.fixture'
import { createFakePrisma } from '../../testing/fake-prisma'
import { ClassificationRulesService } from './classification-rules.service'
import { ClassificationService } from './classification.service'
import { ReclassificationService } from './reclassification.service'

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  await p.classificationRule.createMany({ data: DEFAULT_CLASSIFICATION_RULES })
  const audit = new AuditService(p as never)
  const questionnaires = new QuestionnairesService(p as never)
  const classification = new ClassificationService(p as never)
  const rules = new ClassificationRulesService(p as never, questionnaires, audit)
  const reclassification = new ReclassificationService(p as never, classification, audit)
  // The dossier form: one published version with the financing stage list.
  const form = await p.questionnaire.create({
    data: { slug: 'profil-entreprise', name: 'Profil', usage: 'dossier' },
  })
  const version = await p.questionnaireVersion.create({
    data: { questionnaireId: form.id, version: 1, status: 'published' },
  })
  await createVersionStructure(p as never, version.id, [
    {
      section: 'Financement',
      key: 'stade_financement',
      label: 'Stade de financement',
      fieldType: 'select',
      required: true,
      orderIndex: 0,
      choices: [
        { key: 'fonds_propres_uniquement', label: 'Fonds propres' },
        { key: 'seed_investisseurs_professionnels', label: 'Seed' },
        ...labelsToChoices(['Crowdfunding']),
      ],
    },
  ])
  return { fake, p, rules, reclassification, classification, version }
}

const rulesOf = (fake: ReturnType<typeof createFakePrisma>) => [
  ...fake.table('classificationRule').values(),
]

describe('ClassificationRulesService', () => {
  it('validates a rule against its dimension and refuses duplicates', async () => {
    const { rules } = await setup()
    await expect(
      rules.create(
        {
          dimension: 'axe2_financier',
          fieldKey: 'stade_financement',
          choiceKey: 'crowdfunding',
          value: '9',
          position: 0,
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      rules.create(
        { dimension: 'sector', fieldKey: 'secteur', choiceKey: 'biotech', value: '', position: 0 },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      rules.create(
        {
          dimension: 'axe2_financier',
          fieldKey: 'stade_financement',
          choiceKey: 'seed_investisseurs_professionnels',
          value: '4',
          position: 0,
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('reports what the rules miss in the dossier form, and stops reporting once covered', async () => {
    const { rules } = await setup()
    const [published] = (await rules.coverage()).versions
    const unmapped = published.issues.filter((i) => i.kind === 'unmapped_choice')
    expect(unmapped).toEqual([
      expect.objectContaining({
        dimension: 'axe2_financier',
        choiceKey: 'crowdfunding',
        message: expect.stringContaining('Crowdfunding'),
      }),
    ])
    // Rules reading fields absent from this version are listed once per dimension and field.
    expect(
      published.issues.some((i) => i.kind === 'missing_field' && i.fieldKey === 'origine_projet'),
    ).toBe(true)
    expect(
      published.issues.filter((i) => i.kind === 'missing_choice').map((i) => i.choiceKey),
    ).toEqual(['love_money_subventions_prets_d_honneur', 'pre_serie_a_ou_au_dela'])

    await rules.create(
      {
        dimension: 'axe2_financier',
        fieldKey: 'stade_financement',
        choiceKey: 'crowdfunding',
        value: '3',
        position: 0,
      },
      'admin-1',
    )
    const after = (await rules.coverage()).versions[0].issues
    expect(after.some((i) => i.kind === 'unmapped_choice')).toBe(false)
  })

  it('never rewrites submitted dossiers by itself: preview, then explicit reclassification with audit', async () => {
    const { fake, p, rules, reclassification, classification, version } = await setup()
    const field = [...fake.table('questionnaireField').values()][0]
    await p.dossier.create({
      data: {
        id: 'd-1',
        userId: 'u-1',
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: version.id,
        submittedAt: new Date(),
      },
    })
    await p.dossierAnswer.create({
      data: { dossierId: 'd-1', fieldId: field.id, value: 'seed_investisseurs_professionnels' },
    })
    await classification.classify('d-1')
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(4)

    const rule = rulesOf(fake).find((r) => r.choiceKey === 'seed_investisseurs_professionnels')!
    await rules.update(rule.id, { value: '5' }, 'admin-1')
    // Changing a rule leaves the dossier as classified.
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(4)

    const preview = await reclassification.preview()
    expect(preview).toEqual({
      checked: 1,
      dossiers: [
        {
          dossierId: 'd-1',
          name: 'Biosensio',
          changes: [{ column: 'axe2Financier', from: 4, to: 5 }],
        },
      ],
      rulesRevision: expect.any(String),
    })
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(4)

    const applied = await reclassification.apply('admin-1', preview.rulesRevision)
    expect(applied).toEqual(preview)
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(5)
    const actions = [...fake.table('auditLog').values()].map((a) => a.actionType)
    expect(actions).toEqual(['classification_rules_updated', 'dossier_classified'])
    expect((await reclassification.preview()).dossiers).toEqual([])
  })

  // Code review R44: a rule changed after the preview is not applied under the preview's name; the
  // trace holds what was actually written.
  it('refuses to apply a preview whose rules have changed since, writing nothing', async () => {
    const { fake, p, rules, reclassification, classification, version } = await setup()
    const field = [...fake.table('questionnaireField').values()][0]
    await p.dossier.create({
      data: {
        id: 'd-1',
        userId: 'u-1',
        name: 'Biosensio',
        slug: 'biosensio',
        questionnaireVersionId: version.id,
        submittedAt: new Date(),
      },
    })
    await p.dossierAnswer.create({
      data: { dossierId: 'd-1', fieldId: field.id, value: 'seed_investisseurs_professionnels' },
    })
    await classification.classify('d-1')
    const rule = rulesOf(fake).find((r) => r.choiceKey === 'seed_investisseurs_professionnels')!
    await rules.update(rule.id, { value: '5' }, 'admin-1')
    const preview = await reclassification.preview()
    // Changed again before the administrator applies: 5 is what was previewed, 2 is current.
    await rules.update(rule.id, { value: '2' }, 'admin-1')

    await expect(reclassification.apply('admin-1', preview.rulesRevision)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLASSIFICATION_RULES_CHANGED' }),
    })
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(4)
    const traced = () =>
      [...fake.table('auditLog').values()].filter((a) => a.actionType === 'dossier_classified')
    expect(traced()).toEqual([])

    const fresh = await reclassification.preview()
    const applied = await reclassification.apply('admin-1', fresh.rulesRevision)
    expect(fake.table('dossier').get('d-1')?.axe2Financier).toBe(2)
    expect(applied.dossiers[0].changes).toEqual([{ column: 'axe2Financier', from: 4, to: 2 }])
    expect(traced()[0].metadata).toMatchObject({
      rulesRevision: fresh.rulesRevision,
      changes: [{ column: 'axe2Financier', from: 4, to: 2 }],
    })
  })
})
