import { ConflictException } from '@nestjs/common'
import { SITE_ORIGIN } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { createFakePrisma } from '../../testing/fake-prisma'
import { FormDraftsService } from './form-drafts.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { FormDesignAccess } from './form-design-access'
import { FormsService } from './forms.service'
import { QuestionnairesService } from './questionnaires.service'

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

const auditActions = (fake: ReturnType<typeof createFakePrisma>) =>
  [...fake.table('auditLog').values()].map((a) => a.actionType)

const ADMIN = { id: 'admin-1', role: 'admin' }

describe('FormsService', () => {
  it('creates an unassigned form with an empty draft, a slug derived from the name, and an audit entry', async () => {
    const { fake, forms } = setup()
    const form = await forms.create(ADMIN, 'Appel à projets 2027')
    expect(form).toMatchObject({
      slug: 'appel-a-projets-2027',
      usage: null,
      archivedAt: null,
      published: null,
      draft: { version: 1 },
    })
    expect(form.versions).toEqual([expect.objectContaining({ status: 'draft', version: 1 })])
    expect(auditActions(fake)).toEqual(['form_created'])

    const again = await forms.create(ADMIN, 'Appel à projets 2027')
    expect(again.slug).toBe('appel-a-projets-2027-2')
  })

  it('renames a form but keeps its slug, and refuses to modify an archived form', async () => {
    const { forms } = setup()
    const form = await forms.create(ADMIN, 'Brouillon')
    const renamed = await forms.rename(ADMIN, form.id, 'Candidature incubateur')
    expect(renamed).toMatchObject({ name: 'Candidature incubateur', slug: 'brouillon' })

    await forms.archive(ADMIN, form.id)
    await expect(forms.rename(ADMIN, form.id, 'Autre')).rejects.toBeInstanceOf(ConflictException)
    const restored = await forms.restore(ADMIN, form.id)
    expect(restored.archivedAt).toBeNull()
  })

  it('refuses to archive the form assigned to a usage (it serves new dossiers)', async () => {
    const { forms, questionnaires } = setup()
    await questionnaires.getActive()
    const [dossierForm] = await forms.list(ADMIN)
    expect(dossierForm.usage).toBe('dossier')
    await expect(forms.archive(ADMIN, dossierForm.id)).rejects.toBeInstanceOf(ConflictException)
  })

  it('duplicates the published version into the draft of a new unassigned form, keys included', async () => {
    const { forms, drafts, questionnaires } = setup()
    const active = await questionnaires.getActive()
    const [source] = await forms.list(ADMIN)

    const copy = await forms.duplicate(ADMIN, source.id, 'Profil (copie)')
    expect(copy).toMatchObject({ usage: null, published: null, draft: { version: 1 } })
    const draft = await drafts.getDraft(ADMIN, copy.id)
    expect(draft.sections.map((s) => s.title)).toEqual(active.sections.map((s) => s.title))
    expect(draft.fields.map((f) => [f.key, f.label])).toEqual(
      active.fields.map((f) => [f.key, f.label]),
    )
    // The copy has its own rows: the source version is untouched.
    expect(draft.fields.map((f) => f.id)).not.toContain(active.fields[0].id)
  })

  it('moves the dossier usage to a published form: new dossiers then use its version', async () => {
    const { fake, forms, drafts, questionnaires } = setup()
    const before = await questionnaires.getActive()
    const [profile] = await forms.list(ADMIN)

    const next = await forms.create(ADMIN, 'Profil entreprise 2027')
    await expect(forms.assignUsage(ADMIN, next.id, 'dossier')).rejects.toBeInstanceOf(
      ConflictException,
    )
    const draft = await drafts.addSection(ADMIN, next.id, { title: 'Identité' })
    await drafts.addField(ADMIN, next.id, {
      sectionId: draft.sections[0].id,
      label: 'Nom',
      fieldType: 'text',
      required: true,
    })
    const published = await drafts.publishDraft(ADMIN, next.id, undefined, SITE_ORIGIN)

    const assigned = await forms.assignUsage(ADMIN, next.id, 'dossier')
    expect(assigned.usage).toBe('dossier')
    expect((await forms.get(ADMIN, profile.id)).usage).toBeNull()
    const active = await questionnaires.getActive()
    expect(active.version.id).toBe(published.version.id)
    expect(active.version.id).not.toBe(before.version.id)
    expect([...fake.table('auditLog').values()].at(-1)).toMatchObject({
      actionType: 'form_updated',
      metadata: { change: 'assigned', usage: 'dossier', replacedFormId: profile.id },
    })

    // The former form, now unassigned, can be archived; an archived form cannot be assigned.
    await forms.archive(ADMIN, profile.id)
    await expect(forms.assignUsage(ADMIN, profile.id, 'dossier')).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})

describe('single form design rule on reads (E04.07)', () => {
  const MISSING = '00000000-0000-4000-8000-000000000000'
  const codeOf = (read: Promise<unknown>) =>
    read.then(
      () => 'read',
      (err: { getResponse?: () => { code?: string } }) => err.getResponse?.().code,
    )

  it('refuses every builder read to anyone but an administrator, before looking the form up', async () => {
    const { forms, drafts } = setup()
    const form = await forms.create(ADMIN, 'Candidature')
    const draftId = form.draft!.id
    // Closed by default: a role the rule does not know, or none, reads nothing.
    for (const actor of [
      { id: 'u-1', role: 'entrepreneur' },
      { id: 'u-2', role: 'financeur' },
      { id: 'u-3', role: 'superviseur' },
      { id: 'u-4', role: '' },
    ]) {
      const reads = [
        () => forms.list(actor),
        () => forms.get(actor, form.id),
        () => forms.summary(actor, form.id),
        () => drafts.getDraft(actor, form.id),
        () => drafts.getVersion(actor, form.id, draftId),
        // Same refusal for a form that does not exist: nothing is told about forms.
        () => forms.get(actor, MISSING),
        () => drafts.getDraft(actor, MISSING),
      ]
      for (const read of reads) {
        expect({ role: actor.role, code: await codeOf(read()) }).toEqual({
          role: actor.role,
          code: 'FORM_DESIGN_FORBIDDEN',
        })
      }
    }
    expect(await codeOf(drafts.getVersion(ADMIN, form.id, draftId))).toBe('read')
  })
})
