import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { SITE_ORIGIN } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { FormDraftsService, type FormVersionView } from './form-drafts.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { FormDesignAccess } from './form-design-access'
import { FormsService } from './forms.service'
import { QuestionnairesService } from './questionnaires.service'

const ADMIN = { id: 'admin-1', role: 'admin' }

function setup() {
  const fake = createFakePrisma()
  const prisma = fake.prisma as never
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const design = new FormDesignAccess(new WorkspaceAccessService(prisma))
  const forms = new FormsService(prisma, audit, design)
  const drafts = new FormDraftsService(prisma, forms, questionnaires, audit, design)
  return { fake, forms, drafts, questionnaires }
}

// A new form with one section holding a list field and a text field.
async function formWithStage(s: ReturnType<typeof setup>) {
  const form = await s.forms.create(ADMIN, 'Candidature')
  let draft = await s.drafts.addSection(ADMIN, form.id, { title: 'Financement' })
  const sectionId = draft.sections[0].id
  draft = await s.drafts.addField(ADMIN, form.id, {
    sectionId,
    label: 'Stade de financement',
    fieldType: 'select',
    required: true,
    choices: [{ label: 'Fonds propres' }, { key: 'seed', label: 'Seed' }],
  })
  draft = await s.drafts.addField(ADMIN, form.id, {
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
      s.drafts.addField(ADMIN, form.id, {
        sectionId,
        key: 'montant_recherche',
        label: 'Autre',
        fieldType: 'text',
        required: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      s.drafts.addField(ADMIN, form.id, {
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
    const v1 = await s.drafts.publishDraft(ADMIN, form.id, undefined, SITE_ORIGIN)
    expect(v1.version).toMatchObject({ status: 'published', version: 1 })
    expect(v1.form).toMatchObject({ published: { version: 1 }, draft: null })

    // Draft 2 copies V1 with the same keys; renaming a choice keeps its key.
    let v2 = await s.drafts.createDraft(ADMIN, form.id)
    expect(v2.version).toMatchObject({ status: 'draft', version: 2 })
    const stage = byKey(v2, 'stade_de_financement')
    v2 = await s.drafts.updateField(ADMIN, form.id, stage.id, {
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
    const v1Again = await s.drafts.getVersion(ADMIN, form.id, v1.version.id)
    expect(byKey(v1Again, 'stade_de_financement')).toMatchObject({
      label: 'Stade de financement',
      choices: [
        { key: 'fonds_propres', label: 'Fonds propres' },
        { key: 'seed', label: 'Seed' },
      ],
    })

    const published = await s.drafts.publishDraft(ADMIN, form.id, undefined, SITE_ORIGIN)
    expect(published.version).toMatchObject({ status: 'published', version: 2 })
    const v1Final = await s.drafts.getVersion(ADMIN, form.id, v1.version.id)
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
    await expect(s.drafts.createDraft(ADMIN, form.id)).rejects.toBeInstanceOf(ConflictException)
    await s.drafts.publishDraft(ADMIN, form.id, undefined, SITE_ORIGIN)
    await expect(s.drafts.addSection(ADMIN, form.id, { title: 'Équipe' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('refuses to publish an incomplete draft and lists the problems', async () => {
    const s = setup()
    const form = await s.forms.create(ADMIN, 'Vide')
    let draft = await s.drafts.addSection(ADMIN, form.id, { title: 'Équipe' })
    draft = await s.drafts.addField(ADMIN, form.id, {
      sectionId: draft.sections[0].id,
      label: 'Rôle',
      fieldType: 'select',
      required: true,
    })
    draft = await s.drafts.addSection(ADMIN, form.id, { title: 'Finances' })
    expect(draft.problems.map((p) => p.code)).toEqual(['EMPTY_SECTION', 'SELECT_WITHOUT_CHOICES'])

    const attempt = s.drafts.publishDraft(ADMIN, form.id, undefined, SITE_ORIGIN)
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect((await s.drafts.getDraft(ADMIN, form.id)).version.status).toBe('draft')
  })

  it('changing a list into another type drops its choices', async () => {
    const s = setup()
    const { form, draft } = await formWithStage(s)
    const stage = byKey(draft, 'stade_de_financement')
    const updated = await s.drafts.updateField(ADMIN, form.id, stage.id, { fieldType: 'text' })
    expect(byKey(updated, 'stade_de_financement')).toMatchObject({ fieldType: 'text', choices: [] })
  })

  it('accepts limits that fit the field type, refuses the others, and clears them on a type change', async () => {
    const s = setup()
    const { form, sectionId, draft } = await formWithStage(s)
    const amount = byKey(draft, 'montant_recherche')
    let updated = await s.drafts.updateField(ADMIN, form.id, amount.id, {
      constraints: { min: 0, max: 5_000_000, integer: true },
    })
    expect(byKey(updated, 'montant_recherche').constraints).toEqual({
      min: 0,
      max: 5_000_000,
      integer: true,
    })
    await expect(
      s.drafts.updateField(ADMIN, form.id, amount.id, { constraints: { maxLength: 10 } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      s.drafts.updateField(ADMIN, form.id, amount.id, { constraints: { min: 10, max: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      s.drafts.addField(ADMIN, form.id, {
        sectionId,
        label: 'Date de création',
        fieldType: 'date',
        required: false,
        constraints: { min: 3 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    updated = await s.drafts.updateField(ADMIN, form.id, amount.id, { fieldType: 'text' })
    expect(byKey(updated, 'montant_recherche').constraints).toEqual({})
  })

  it('reorders, moves and removes, keeping positions contiguous', async () => {
    const s = setup()
    const { form, sectionId } = await formWithStage(s)
    let draft = await s.drafts.addSection(ADMIN, form.id, { title: 'Équipe' })
    const team = draft.sections[1].id
    const [stage, amount] = draft.fields

    draft = await s.drafts.reorderFields(ADMIN, form.id, sectionId, [amount.id, stage.id])
    expect(draft.fields.map((f) => f.key)).toEqual(['montant_recherche', 'stade_de_financement'])

    draft = await s.drafts.reorderSections(ADMIN, form.id, [team, sectionId])
    expect(draft.sections.map((x) => x.title)).toEqual(['Équipe', 'Financement'])

    // Moving the first field of « Financement » to « Équipe » renumbers what stays behind.
    draft = await s.drafts.updateField(ADMIN, form.id, amount.id, { sectionId: team })
    expect(draft.fields.map((f) => [f.key, f.sectionId, f.orderIndex])).toEqual([
      ['montant_recherche', team, 0],
      ['stade_de_financement', sectionId, 0],
    ])

    draft = await s.drafts.removeSection(ADMIN, form.id, team)
    expect(draft.sections.map((x) => [x.title, x.orderIndex])).toEqual([['Financement', 0]])
    expect(draft.fields.map((f) => f.key)).toEqual(['stade_de_financement'])

    await expect(s.drafts.reorderSections(ADMIN, form.id, [team])).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('discards a draft and its structure; the published version stays', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    await s.drafts.publishDraft(ADMIN, form.id, undefined, SITE_ORIGIN)
    const draft = await s.drafts.createDraft(ADMIN, form.id)
    await s.drafts.discardDraft(ADMIN, form.id)
    await expect(s.drafts.getDraft(ADMIN, form.id)).rejects.toBeInstanceOf(NotFoundException)
    expect([...s.fake.table('questionnaireField').values()].map((f) => f.versionId)).not.toContain(
      draft.version.id,
    )
    expect((await s.forms.get(ADMIN, form.id)).published).toMatchObject({ version: 1 })
  })

  it('never reads a version through another form', async () => {
    const s = setup()
    const { form } = await formWithStage(s)
    const other = await s.forms.create(ADMIN, 'Autre')
    const draft = await s.drafts.getDraft(ADMIN, form.id)
    await expect(s.drafts.getVersion(ADMIN, other.id, draft.version.id)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  // E04.07: the same rule for the site's builder and the MCP tools, checked by the services
  // themselves; closed by default (unknown role refused), nothing written.
  it.each(['entrepreneur', 'financeur', 'superviseur', ''])(
    'refuses every write to a %s account, before writing anything',
    async (role) => {
      const s = setup()
      const { form, sectionId, draft } = await formWithStage(s)
      const stage = byKey(draft, 'stade_de_financement')
      const before = JSON.stringify([...s.fake.table('questionnaireField').values()])
      const other = { id: 'u-1', role }
      const writes = [
        () => s.forms.create(other, 'Intrus'),
        () => s.forms.rename(other, form.id, 'Intrus'),
        () => s.forms.duplicate(other, form.id, 'Intrus'),
        () => s.forms.assignUsage(other, form.id, 'dossier'),
        () => s.forms.archive(other, form.id),
        () => s.forms.restore(other, form.id),
        () => s.drafts.createDraft(other, form.id),
        () => s.drafts.discardDraft(other, form.id),
        () => s.drafts.publishDraft(other, form.id, undefined, SITE_ORIGIN),
        () => s.drafts.addSection(other, form.id, { title: 'Intrus' }),
        () => s.drafts.updateSection(other, form.id, sectionId, { title: 'Intrus' }),
        () => s.drafts.removeSection(other, form.id, sectionId),
        () => s.drafts.reorderSections(other, form.id, [sectionId]),
        () =>
          s.drafts.addField(other, form.id, {
            sectionId,
            label: 'Intrus',
            fieldType: 'text',
            required: false,
          }),
        () => s.drafts.updateField(other, form.id, stage.id, { label: 'Intrus' }),
        () => s.drafts.removeField(other, form.id, stage.id),
        () => s.drafts.reorderFields(other, form.id, sectionId, [stage.id]),
      ]
      for (const write of writes) {
        await expect(write()).rejects.toBeInstanceOf(ForbiddenException)
      }
      expect(JSON.stringify([...s.fake.table('questionnaireField').values()])).toBe(before)
      expect((await s.forms.list(ADMIN)).map((f) => f.name)).toEqual(['Candidature'])
    },
  )
})
