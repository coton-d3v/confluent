import { QuestionnairesService } from './questionnaires.service'
import { createVersionStructure } from './questionnaire-structure'
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

  it('reads a version with fields ordered by section, then position, whatever the insertion order', async () => {
    const { fake, svc } = setup()
    const version = await fake.prisma.questionnaireVersion.create({
      data: { questionnaireId: 'form-1', version: 1, status: 'draft' },
    })
    await createVersionStructure(fake.prisma as never, version.id, [
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
    const structure = (await svc.getVersion(version.id))!
    expect(structure.sections.map((x) => x.title)).toEqual(['Identité', 'Finances'])
    // Generated keys never collide within a version (given in input order); explicit keys are kept.
    expect(structure.fields.map((f) => f.key)).toEqual([
      'nom_du_projet_2',
      'nom_du_projet',
      'montant',
    ])
  })
})
