import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { AuditService } from '../../src/modules/audit/audit.service'
import { FormDraftsService } from '../../src/modules/questionnaires/form-drafts.service'
import { FormDesignAccess } from '../../src/modules/questionnaires/form-design-access'
import { FormsService } from '../../src/modules/questionnaires/forms.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../../src/modules/workspaces/workspace-access'
import { testDatabase } from './database'

const ADMIN = { id: 'admin-test', role: 'admin' }

// Code review R30: an edit running while the draft is being published must never change the
// published version. A publication holding the form for a while is simulated by a transaction that
// takes the same lock as the services, publishes the draft, then waits before committing.
describe('form drafts under concurrency (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const design = new FormDesignAccess(new WorkspaceAccessService(prisma))
  const forms = new FormsService(prisma, audit, design)
  const drafts = new FormDraftsService(
    prisma,
    forms,
    new QuestionnairesService(prisma),
    audit,
    design,
  )

  afterAll(() => prisma.$disconnect())

  async function formWithDraft() {
    const form = await forms.create(ADMIN, `Concurrence ${randomUUID()}`)
    const draft = await drafts.addSection(ADMIN, form.id, { title: 'Projet' })
    const withField = await drafts.addField(ADMIN, form.id, {
      sectionId: draft.sections[0].id,
      label: 'Nom du projet',
      fieldType: 'text',
      required: true,
    })
    return { formId: form.id, versionId: withField.version.id, fieldId: withField.fields[0].id }
  }

  // Publishes inside a transaction holding the form lock; `published` resolves once the status is
  // changed (not committed yet), the commit happens `holdMs` later.
  function slowPublish(formId: string, versionId: string, holdMs: number) {
    let signal!: () => void
    const published = new Promise<void>((resolve) => (signal = resolve))
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "questionnaires" WHERE "id" = ${formId} FOR UPDATE`
        await tx.questionnaireVersion.update({
          where: { id: versionId },
          data: { status: 'published', publishedAt: new Date() },
        })
        signal()
        await new Promise((r) => setTimeout(r, holdMs))
      },
      { timeout: 10_000 },
    )
    return { published, done }
  }

  it('an edit started during a publication does not reach the published version', async () => {
    const { formId, versionId, fieldId } = await formWithDraft()
    const publication = slowPublish(formId, versionId, 400)
    await publication.published

    const edit = drafts.updateField(ADMIN, formId, fieldId, { label: 'Modifié après publication' })
    await publication.done
    await expect(edit).rejects.toBeInstanceOf(NotFoundException)

    const field = await prisma.questionnaireField.findUniqueOrThrow({ where: { id: fieldId } })
    expect(field.label).toBe('Nom du projet')
  })

  it('a field removal started during a publication does not reach the published version', async () => {
    const { formId, versionId, fieldId } = await formWithDraft()
    const publication = slowPublish(formId, versionId, 400)
    await publication.published

    const removal = drafts.removeField(ADMIN, formId, fieldId)
    await publication.done
    await expect(removal).rejects.toBeInstanceOf(NotFoundException)
    expect(await prisma.questionnaireField.count({ where: { id: fieldId } })).toBe(1)
  })

  it('a discard started during a publication leaves the published version intact', async () => {
    const { formId, versionId, fieldId } = await formWithDraft()
    const publication = slowPublish(formId, versionId, 400)
    await publication.published

    const discard = drafts.discardDraft(ADMIN, formId)
    await publication.done
    await expect(discard).rejects.toBeInstanceOf(NotFoundException)
    const version = await prisma.questionnaireVersion.findUniqueOrThrow({
      where: { id: versionId },
    })
    expect(version.status).toBe('published')
    expect(await prisma.questionnaireField.count({ where: { id: fieldId } })).toBe(1)
  })

  it('an edit waits for an archiving in progress, then is refused', async () => {
    const { formId, fieldId } = await formWithDraft()
    let signal!: () => void
    const locked = new Promise<void>((resolve) => (signal = resolve))
    const archiving = prisma.$transaction(async (tx) => {
      await forms.lockForm(tx, formId, null)
      await tx.questionnaire.update({ where: { id: formId }, data: { archivedAt: new Date() } })
      signal()
      await new Promise((r) => setTimeout(r, 400))
    })
    await locked
    const edit = drafts.updateField(ADMIN, formId, fieldId, { label: 'Après archivage' })
    await archiving
    await expect(edit).rejects.toMatchObject({ response: { code: 'FORM_ARCHIVED' } })
    const field = await prisma.questionnaireField.findUniqueOrThrow({ where: { id: fieldId } })
    expect(field.label).toBe('Nom du projet')
  })

  it('refuses an edit based on an outdated revision of the draft', async () => {
    const { formId, fieldId } = await formWithDraft()
    const seen = (await drafts.getDraft(ADMIN, formId)).version.updatedAt.toISOString()
    await drafts.updateField(ADMIN, formId, fieldId, { label: 'Premier administrateur' }, seen)
    await expect(
      drafts.updateField(ADMIN, formId, fieldId, { label: 'Second administrateur' }, seen),
    ).rejects.toMatchObject({ response: { code: 'DRAFT_STALE' } })
    const field = await prisma.questionnaireField.findUniqueOrThrow({ where: { id: fieldId } })
    expect(field.label).toBe('Premier administrateur')
  })
})
