import { ConflictException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { FormDraftsService } from './form-drafts.service'
import { FormsService } from './forms.service'
import { QuestionnairesService } from './questionnaires.service'

function setup() {
  const fake = createFakePrisma()
  const prisma = fake.prisma as never
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const forms = new FormsService(prisma, audit)
  const drafts = new FormDraftsService(prisma, forms, questionnaires, audit)
  return { fake, forms, drafts, questionnaires }
}

const auditActions = (fake: ReturnType<typeof createFakePrisma>) =>
  [...fake.table('auditLog').values()].map((a) => a.actionType)

describe('FormsService', () => {
  it('creates an unassigned form with an empty draft, a slug derived from the name, and an audit entry', async () => {
    const { fake, forms } = setup()
    const form = await forms.create('Appel à projets 2027', 'admin-1')
    expect(form).toMatchObject({
      slug: 'appel-a-projets-2027',
      usage: null,
      archivedAt: null,
      published: null,
      draft: { version: 1 },
    })
    expect(form.versions).toEqual([expect.objectContaining({ status: 'draft', version: 1 })])
    expect(auditActions(fake)).toEqual(['form_created'])

    const again = await forms.create('Appel à projets 2027', 'admin-1')
    expect(again.slug).toBe('appel-a-projets-2027-2')
  })

  it('renames a form but keeps its slug, and refuses to modify an archived form', async () => {
    const { forms } = setup()
    const form = await forms.create('Brouillon', 'admin-1')
    const renamed = await forms.rename(form.id, 'Candidature incubateur', 'admin-1')
    expect(renamed).toMatchObject({ name: 'Candidature incubateur', slug: 'brouillon' })

    await forms.archive(form.id, 'admin-1')
    await expect(forms.rename(form.id, 'Autre', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    )
    const restored = await forms.restore(form.id, 'admin-1')
    expect(restored.archivedAt).toBeNull()
  })

  it('refuses to archive the form assigned to a usage (it serves new dossiers)', async () => {
    const { forms, questionnaires } = setup()
    await questionnaires.getActive()
    const [dossierForm] = await forms.list()
    expect(dossierForm.usage).toBe('dossier')
    await expect(forms.archive(dossierForm.id, 'admin-1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('duplicates the published version into the draft of a new unassigned form, keys included', async () => {
    const { forms, drafts, questionnaires } = setup()
    const active = await questionnaires.getActive()
    const [source] = await forms.list()

    const copy = await forms.duplicate(source.id, 'Profil (copie)', 'admin-1')
    expect(copy).toMatchObject({ usage: null, published: null, draft: { version: 1 } })
    const draft = await drafts.getDraft(copy.id)
    expect(draft.sections.map((s) => s.title)).toEqual(active.sections.map((s) => s.title))
    expect(draft.fields.map((f) => [f.key, f.label])).toEqual(
      active.fields.map((f) => [f.key, f.label]),
    )
    // The copy has its own rows: the source version is untouched.
    expect(draft.fields.map((f) => f.id)).not.toContain(active.fields[0].id)
  })
})
