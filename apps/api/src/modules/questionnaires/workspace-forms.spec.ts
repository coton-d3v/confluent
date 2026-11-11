import { HttpException } from '@nestjs/common'
import { createFakePrisma } from '../../testing/fake-prisma'
import { SITE_ORIGIN } from '../audit/action-origin'
import { AuditService } from '../audit/audit.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { FormDesignAccess, canDesignForms, type FormDesigner } from './form-design-access'
import { FormDraftsService } from './form-drafts.service'
import { FormsService } from './forms.service'
import { QuestionnairesService } from './questionnaires.service'

// ROADMAP E05.09: the single form design rule, widened to each workspace's own forms, and every
// read and write of the builder kept to the forms of the designer's owner (Confluent, or the
// workspace the request names).
const ADMIN = { id: 'u-admin', role: 'admin' }
// Manager of the CCI (a financeur account, as an invitation leaves it).
const MARIE = { id: 'u-marie', role: 'financeur' }
// Conseiller of the CCI without the right to manage it.
const JEAN = { id: 'u-jean', role: 'financeur' }
// Investisseur of the CCI.
const CLAIRE = { id: 'u-claire', role: 'financeur' }
// Manager of the club deal.
const PAUL = { id: 'u-paul', role: 'financeur' }
const SOPHIE = { id: 'u-sophie', role: 'entrepreneur' }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

const inWs = (actor: { id: string; role: string }, workspaceId: string): FormDesigner => ({
  ...actor,
  workspaceId,
})

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  await p.workspace.create({ data: { id: CCI, slug: 'cci-touraine', name: 'CCI Touraine' } })
  await p.workspace.create({ data: { id: CLUB, slug: 'club', name: 'Club deal' } })
  const member = (workspaceId: string, userId: string, role: string, canManageWorkspace = false) =>
    p.workspaceMembership.create({ data: { workspaceId, userId, role, canManageWorkspace } })
  const marie = await member(CCI, MARIE.id, 'conseiller', true)
  await member(CCI, JEAN.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  await member(CLUB, PAUL.id, 'conseiller', true)
  const prisma = p as never
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
  return { fake, p, forms, drafts, marie }
}

async function status(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    if (err instanceof HttpException) return err.getStatus()
    throw err
  }
}

// A published one-question form of `designer`'s owner.
async function publishedForm(s: Awaited<ReturnType<typeof setup>>, designer: FormDesigner) {
  const form = await s.forms.create(designer, 'Formulaire complémentaire')
  const draft = await s.drafts.addSection(designer, form.id, { title: 'Projet' })
  await s.drafts.addField(designer, form.id, {
    sectionId: draft.sections[0].id,
    label: 'Pourquoi notre programme ?',
    fieldType: 'textarea',
    required: true,
  })
  await s.drafts.publishDraft(designer, form.id, undefined, SITE_ORIGIN)
  return form
}

describe('canDesignForms (E05.09)', () => {
  const membership = (
    role: string,
    canManageWorkspace: boolean,
    deactivatedAt: Date | null = null,
  ) => ({
    role,
    canManageWorkspace,
    deactivatedAt,
  })

  it('keeps Confluent’s own forms to its administrators', () => {
    expect(canDesignForms({ role: 'admin' })).toBe(true)
    for (const role of ['entrepreneur', 'financeur', 'conseiller', 'unknown']) {
      expect(canDesignForms({ role })).toBe(false)
    }
  })

  it('opens a workspace’s forms to whoever manages it, and to nobody else', () => {
    expect(canDesignForms({ role: 'admin' }, { membership: null })).toBe(true)
    expect(
      canDesignForms({ role: 'financeur' }, { membership: membership('conseiller', true) }),
    ).toBe(true)
    // Closed by default: no right, an investisseur, a deactivated membership, an unknown role, none.
    expect(
      canDesignForms({ role: 'financeur' }, { membership: membership('conseiller', false) }),
    ).toBe(false)
    expect(
      canDesignForms({ role: 'financeur' }, { membership: membership('investisseur', true) }),
    ).toBe(false)
    expect(
      canDesignForms(
        { role: 'financeur' },
        { membership: membership('conseiller', true, new Date()) },
      ),
    ).toBe(false)
    expect(
      canDesignForms({ role: 'financeur' }, { membership: membership('gestionnaire', true) }),
    ).toBe(false)
    expect(canDesignForms({ role: 'entrepreneur' }, { membership: null })).toBe(false)
  })
})

describe('forms of a workspace (E05.09)', () => {
  it('lets the workspace’s managers and administrators design them; 403 to its other members, 404 outside', async () => {
    const s = await setup()
    const form = await s.forms.create(inWs(MARIE, CCI), 'Questionnaire CCI')
    expect(form).toMatchObject({ usage: null, slug: 'cci-touraine--questionnaire-cci' })
    expect(await status(s.forms.get(inWs(ADMIN, CCI), form.id))).toBe('ok')
    expect(await status(s.forms.list(inWs(JEAN, CCI)))).toBe(403)
    expect(await status(s.forms.list(inWs(CLAIRE, CCI)))).toBe(403)
    expect(await status(s.forms.create(inWs(JEAN, CCI), 'Autre'))).toBe(403)
    // Manager of another workspace, entrepreneur: not in the CCI, the same 404 as an unknown one.
    expect(await status(s.forms.list(inWs(PAUL, CCI)))).toBe(404)
    expect(await status(s.forms.list(inWs(SOPHIE, CCI)))).toBe(404)
    expect(await status(s.forms.list(inWs(MARIE, 'ws-unknown')))).toBe(404)
    // Without a workspace: Confluent's forms, administrators only.
    expect(await status(s.forms.list(MARIE))).toBe(403)
  })

  it('reads again the membership at each request: a manager who lost the right designs no more', async () => {
    const s = await setup()
    const form = await s.forms.create(inWs(MARIE, CCI), 'Questionnaire CCI')
    await s.p.workspaceMembership.update({
      where: { id: s.marie.id },
      data: { canManageWorkspace: false },
    })
    expect(await status(s.forms.get(inWs(MARIE, CCI), form.id))).toBe(403)
    await s.p.workspaceMembership.update({
      where: { id: s.marie.id },
      data: { canManageWorkspace: true, deactivatedAt: new Date() },
    })
    expect(await status(s.forms.get(inWs(MARIE, CCI), form.id))).toBe(404)
  })

  it('keeps each owner to its own forms: another workspace’s or Confluent’s are not found, nor listed', async () => {
    const s = await setup()
    const cciForm = await s.forms.create(inWs(MARIE, CCI), 'Questionnaire CCI')
    const clubForm = await s.forms.create(inWs(PAUL, CLUB), 'Questionnaire club')
    const confluentForm = await s.forms.create(ADMIN, 'Profil bis')

    expect((await s.forms.list(inWs(MARIE, CCI))).map((f) => f.id)).toEqual([cciForm.id])
    expect((await s.forms.list(inWs(ADMIN, CLUB))).map((f) => f.id)).toEqual([clubForm.id])
    expect((await s.forms.list(ADMIN)).map((f) => f.id)).toEqual([confluentForm.id])

    // Every read and write of another owner's form: 404, even for an administrator in the wrong place.
    const foreign: Array<[FormDesigner, string]> = [
      [inWs(MARIE, CCI), clubForm.id],
      [inWs(MARIE, CCI), confluentForm.id],
      [inWs(ADMIN, CCI), clubForm.id],
      [ADMIN, cciForm.id],
    ]
    for (const [designer, formId] of foreign) {
      expect(await status(s.forms.get(designer, formId))).toBe(404)
      expect(await status(s.forms.rename(designer, formId, 'Pris'))).toBe(404)
      expect(await status(s.forms.duplicate(designer, formId, 'Copie'))).toBe(404)
      expect(await status(s.forms.archive(designer, formId))).toBe(404)
      expect(await status(s.drafts.getDraft(designer, formId))).toBe(404)
      expect(await status(s.drafts.addSection(designer, formId, { title: 'Intrus' }))).toBe(404)
      expect(await status(s.drafts.publishDraft(designer, formId, undefined, SITE_ORIGIN))).toBe(
        404,
      )
      expect(await status(s.drafts.discardDraft(designer, formId))).toBe(404)
    }
    // Nothing changed.
    expect(s.fake.table('questionnaireSection').size).toBe(0)
    expect([...s.fake.table('questionnaire').values()].map((f) => f.name).sort()).toEqual([
      'Profil bis',
      'Questionnaire CCI',
      'Questionnaire club',
    ])
  })

  it('assigns a workspace’s form to its candidatures only, replacing that workspace’s previous one', async () => {
    const s = await setup()
    const first = await publishedForm(s, inWs(MARIE, CCI))
    const second = await publishedForm(s, inWs(MARIE, CCI))
    const club = await publishedForm(s, inWs(PAUL, CLUB))
    expect(await status(s.forms.assignUsage(inWs(MARIE, CCI), first.id, 'dossier'))).toBe(400)
    await s.forms.assignUsage(inWs(MARIE, CCI), first.id, 'candidature')
    await s.forms.assignUsage(inWs(PAUL, CLUB), club.id, 'candidature')
    await s.forms.assignUsage(inWs(MARIE, CCI), second.id, 'candidature')
    const usages = Object.fromEntries(
      [...s.fake.table('questionnaire').values()].map((f) => [f.id, f.usage]),
    )
    // The club's assignment is untouched by the CCI's.
    expect(usages).toEqual({
      [first.id]: null,
      [second.id]: 'candidature',
      [club.id]: 'candidature',
    })
    // Confluent's forms serve the company profile only.
    const confluent = await publishedForm(s, ADMIN)
    expect(await status(s.forms.assignUsage(ADMIN, confluent.id, 'candidature'))).toBe(400)
  })

  it('refuses attachment fields in a workspace’s forms, not in Confluent’s', async () => {
    const s = await setup()
    const form = await s.forms.create(inWs(MARIE, CCI), 'Questionnaire CCI')
    const draft = await s.drafts.addSection(inWs(MARIE, CCI), form.id, { title: 'Projet' })
    const sectionId = draft.sections[0].id
    const file = { sectionId, label: 'Plaquette', fieldType: 'file' as const, required: false }
    expect(await status(s.drafts.addField(inWs(MARIE, CCI), form.id, file))).toBe(400)
    const text = await s.drafts.addField(inWs(MARIE, CCI), form.id, { ...file, fieldType: 'text' })
    const fieldId = text.fields[0].id
    expect(
      await status(s.drafts.updateField(inWs(MARIE, CCI), form.id, fieldId, { fieldType: 'file' })),
    ).toBe(400)

    const confluent = await s.forms.create(ADMIN, 'Profil bis')
    const own = await s.drafts.addSection(ADMIN, confluent.id, { title: 'Pièces' })
    expect(
      await status(
        s.drafts.addField(ADMIN, confluent.id, { ...file, sectionId: own.sections[0].id }),
      ),
    ).toBe('ok')
  })
})
