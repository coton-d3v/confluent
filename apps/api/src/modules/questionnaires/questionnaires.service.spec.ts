import { QuestionnairesService } from './questionnaires.service'
import { createFakePrisma } from '../../testing/fake-prisma'

function setup() {
  const fake = createFakePrisma()
  return { fake, svc: new QuestionnairesService(fake.prisma as never) }
}

describe('QuestionnairesService', () => {
  it('bootstraps the dossier form and a published V1 with ordered sections on an empty database', async () => {
    const { fake, svc } = setup()
    const active = await svc.getActive()
    expect(active.version).toMatchObject({ version: 1, status: 'published' })
    expect(active.sections.map((s) => s.title)).toEqual([
      'Présentation',
      'Marché & produit',
      'Finances & équipe',
    ])
    expect(active.fields).toHaveLength(12)
    // Fields come ordered by section, then position.
    expect(active.fields[0].sectionId).toBe(active.sections[0].id)
    expect(active.fields.at(-1)!.sectionId).toBe(active.sections[2].id)
    expect(new Set(active.fields.map((f) => f.key)).size).toBe(12)
    expect([...fake.table('questionnaire').values()]).toHaveLength(1)

    await svc.getActive()
    expect(fake.table('questionnaireVersion').size).toBe(1)
  })

  it('publishing a new version archives the previous one: exactly one published version', async () => {
    const { fake, svc } = setup()
    await svc.getActive()
    const v2 = await svc.createVersion([
      {
        section: 'Identité',
        label: 'Nom du projet',
        fieldType: 'text',
        required: true,
        orderIndex: 1,
      },
      {
        section: 'Identité',
        label: 'Nom du projet',
        fieldType: 'text',
        required: false,
        orderIndex: 0,
      },
      {
        section: 'Finances',
        key: 'montant',
        label: 'Montant',
        fieldType: 'number',
        required: false,
        orderIndex: 0,
      },
    ])
    expect(v2).toMatchObject({ version: 2, status: 'published' })
    const statuses = [...fake.table('questionnaireVersion').values()].map(
      (v) => `${String(v.version)}:${String(v.status)}`,
    )
    expect(statuses.sort()).toEqual(['1:archived', '2:published'])
    const active = await svc.getActive()
    expect(active.version.id).toBe(v2.id)
    // Generated keys never collide within a version (given in input order); explicit keys are kept;
    // reading returns fields by section, then position.
    expect(active.fields.map((f) => f.key)).toEqual(['nom_du_projet_2', 'nom_du_projet', 'montant'])
  })

  it('keeps explicit choice keys and derives the missing ones, unique within the field', async () => {
    const { svc } = setup()
    await svc.getActive()
    const v2 = await svc.createVersion([
      {
        section: 'Financement',
        key: 'stade_financement',
        label: 'Stade de financement',
        fieldType: 'select',
        required: true,
        orderIndex: 0,
        choices: [
          // Renamed label, key kept from the previous version: answers and classification unchanged.
          { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
          { label: 'Seed' },
          { label: 'seed' },
          { label: 'Fonds propres uniquement' },
        ],
      },
    ])
    const field = (await svc.getVersion(v2.id))!.fields[0]
    expect(field.choices).toEqual([
      { key: 'fonds_propres_uniquement', label: 'Autofinancement' },
      { key: 'seed', label: 'Seed' },
      { key: 'seed_2', label: 'seed' },
      { key: 'fonds_propres_uniquement_2', label: 'Fonds propres uniquement' },
    ])
  })
})
