import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { FormDraftsService, type FormVersionView } from './form-drafts.service'
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

// A new form with one section holding a list field and a text field.
async function formWithStage(s: ReturnType<typeof setup>) {
  const form = await s.forms.create('Candidature', 'admin-1')
  let draft = await s.drafts.addSection(form.id, { title: 'Financement' })
  const sectionId = draft.sections[0].id
  draft = await s.drafts.addField(form.id, {
    sectionId,
    label: 'Stade de financement',
    fieldType: 'select',
    required: true,
    choices: [{ label: 'Fonds propres' }, { key: 'seed', label: 'Seed' }],
  })
  draft = await s.drafts.addField(form.id, {
    sectionId,
    label: 'Montant recherché',
    fieldType: 'number',
    required: false,
  })
  return { form, draft, sectionId }
}

const byKey = (view: FormVersionView, key: string) => view.fields.find((f) => f.key === key)!

describe('FormDraftsService', () => {
  it('builds a draft: derived keys, positions, restrictive default level, publishable', async () => {
    const s = setup()
    const { draft } = await formWithStage(s)
    expect(draft.version.status).toBe('draft')
    expect(draft.sections).toEqual([
      expect.objectContaining({ key: 'financement', title: 'Financement', orderIndex: 0 }),
    ])
    expect(draft.fields.map((f) => [f.key, f.orderIndex, f.minAccessLevel])).toEqual([
      ['stade_de_financement', 0, 'complet'],
      ['montant_recherche', 1, 'complet'],
    ])
    expect(byKey(draft, 'stade_de_financement').choices).toEqual([
      { key: 'fonds_propres', label: 'Fonds propres' },
      { key: 'seed', label: 'Seed' },
    ])
    expect(draft.problems).toEqual([])
  })

  it('refuses a key already used in the draft, and choices on a non-list field', async () => {
    const s = setup()
    const { form, sectionId } = await formWithStage(s)
    await expect(
      s.drafts.addField(form.id, {
        sectionId,
        key: 'montant_recherche',
        label: 'Autre',
        fieldType: 'text',
        required: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      s.drafts.addField(form.id, {
        sectionId,
        label: 'Commentaire',
        fieldType: 'text',
        required: false,
        choices: [{ label: 'x' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('publishing archives the previous version; a new draft copies it and edits never reach it', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    const v1 = await s.drafts.publishDraft(form.id, 'admin-1')
    expect(v1.version).toMatchObject({ status: 'published', version: 1 })
    expect(v1.form).toMatchObject({ published: { version: 1 }, draft: null })

    // Draft 2 copies V1 with the same keys; renaming a choice keeps its key.
    let v2 = await s.drafts.createDraft(form.id, 'admin-1')
    expect(v2.version).toMatchObject({ status: 'draft', version: 2 })
    const stage = byKey(v2, 'stade_de_financement')
    v2 = await s.drafts.updateField(form.id, stage.id, {
      label: 'Stade actuel de financement',
      choices: [
        { key: 'fonds_propres', label: 'Autofinancement' },
        { key: 'seed', label: 'Seed' },
      ],
    })
    expect(byKey(v2, 'stade_de_financement')).toMatchObject({
      label: 'Stade actuel de financement',
      choices: [
        { key: 'fonds_propres', label: 'Autofinancement' },
        { key: 'seed', label: 'Seed' },
      ],
    })

    // V1, read by existing dossiers, is unchanged.
    const v1Again = await s.drafts.getVersion(form.id, v1.version.id)
    expect(byKey(v1Again, 'stade_de_financement')).toMatchObject({
      label: 'Stade de financement',
      choices: [
        { key: 'fonds_propres', label: 'Fonds propres' },
        { key: 'seed', label: 'Seed' },
      ],
    })

    const published = await s.drafts.publishDraft(form.id, 'admin-1')
    expect(published.version).toMatchObject({ status: 'published', version: 2 })
    const v1Final = await s.drafts.getVersion(form.id, v1.version.id)
    expect(v1Final.version.status).toBe('archived')
    expect([...s.fake.table('auditLog').values()].map((a) => a.actionType)).toEqual([
      'form_created',
      'questionnaire_version_published',
      'form_draft_created',
      'questionnaire_version_published',
    ])
  })

  it('refuses a second draft, and edits when there is no draft', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    await expect(s.drafts.createDraft(form.id, 'admin-1')).rejects.toBeInstanceOf(ConflictException)
    await s.drafts.publishDraft(form.id, 'admin-1')
    await expect(s.drafts.addSection(form.id, { title: 'Équipe' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('refuses to publish an incomplete draft and lists the problems', async () => {
    const s = setup()
    const form = await s.forms.create('Vide', 'admin-1')
    let draft = await s.drafts.addSection(form.id, { title: 'Équipe' })
    draft = await s.drafts.addField(form.id, {
      sectionId: draft.sections[0].id,
      label: 'Rôle',
      fieldType: 'select',
      required: true,
    })
    draft = await s.drafts.addSection(form.id, { title: 'Finances' })
    expect(draft.problems.map((p) => p.code)).toEqual(['EMPTY_SECTION', 'SELECT_WITHOUT_CHOICES'])

    const attempt = s.drafts.publishDraft(form.id, 'admin-1')
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect((await s.drafts.getDraft(form.id)).version.status).toBe('draft')
  })

  it('changing a list into another type drops its choices', async () => {
    const s = setup()
    const { form, draft } = await formWithStage(s)
    const stage = byKey(draft, 'stade_de_financement')
    const updated = await s.drafts.updateField(form.id, stage.id, { fieldType: 'text' })
    expect(byKey(updated, 'stade_de_financement')).toMatchObject({ fieldType: 'text', choices: [] })
  })

  it('accepts limits that fit the field type, refuses the others, and clears them on a type change', async () => {
    const s = setup()
    const { form, sectionId, draft } = await formWithStage(s)
    const amount = byKey(draft, 'montant_recherche')
    let updated = await s.drafts.updateField(form.id, amount.id, {
      constraints: { min: 0, max: 5_000_000, integer: true },
    })
    expect(byKey(updated, 'montant_recherche').constraints).toEqual({
      min: 0,
      max: 5_000_000,
      integer: true,
    })
    await expect(
      s.drafts.updateField(form.id, amount.id, { constraints: { maxLength: 10 } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      s.drafts.updateField(form.id, amount.id, { constraints: { min: 10, max: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      s.drafts.addField(form.id, {
        sectionId,
        label: 'Date de création',
        fieldType: 'date',
        required: false,
        constraints: { min: 3 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    updated = await s.drafts.updateField(form.id, amount.id, { fieldType: 'text' })
    expect(byKey(updated, 'montant_recherche').constraints).toEqual({})
  })

  it('reorders, moves and removes, keeping positions contiguous', async () => {
    const s = setup()
    const { form, sectionId } = await formWithStage(s)
    let draft = await s.drafts.addSection(form.id, { title: 'Équipe' })
    const team = draft.sections[1].id
    const [stage, amount] = draft.fields

    draft = await s.drafts.reorderFields(form.id, sectionId, [amount.id, stage.id])
    expect(draft.fields.map((f) => f.key)).toEqual(['montant_recherche', 'stade_de_financement'])

    draft = await s.drafts.reorderSections(form.id, [team, sectionId])
    expect(draft.sections.map((x) => x.title)).toEqual(['Équipe', 'Financement'])

    // Moving the first field of « Financement » to « Équipe » renumbers what stays behind.
    draft = await s.drafts.updateField(form.id, amount.id, { sectionId: team })
    expect(draft.fields.map((f) => [f.key, f.sectionId, f.orderIndex])).toEqual([
      ['montant_recherche', team, 0],
      ['stade_de_financement', sectionId, 0],
    ])

    draft = await s.drafts.removeSection(form.id, team)
    expect(draft.sections.map((x) => [x.title, x.orderIndex])).toEqual([['Financement', 0]])
    expect(draft.fields.map((f) => f.key)).toEqual(['stade_de_financement'])

    await expect(s.drafts.reorderSections(form.id, [team])).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('discards a draft and its structure; the published version stays', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    await s.drafts.publishDraft(form.id, 'admin-1')
    const draft = await s.drafts.createDraft(form.id, 'admin-1')
    await s.drafts.discardDraft(form.id, 'admin-1')
    await expect(s.drafts.getDraft(form.id)).rejects.toBeInstanceOf(NotFoundException)
    expect([...s.fake.table('questionnaireField').values()].map((f) => f.versionId)).not.toContain(
      draft.version.id,
    )
    expect((await s.forms.get(form.id)).published).toMatchObject({ version: 1 })
  })

  it('never reads a version through another form', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    const other = await s.forms.create('Autre', 'admin-1')
    const draft = await s.drafts.getDraft(form.id)
    await expect(s.drafts.getVersion(other.id, draft.version.id)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
