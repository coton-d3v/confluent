import { HttpException } from '@nestjs/common'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import { AuditLogService } from '../audit/audit-log.service'
import { actionsFor, ownerRule } from '../owner-history/owner-history.rules'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { createDefaultEligibilitySchemes } from '../eligibilities/eligibility-scheme-defaults'
import { EligibilitiesService } from '../eligibilities/eligibilities.service'
import { FundingPlansService } from '../funding-plans/funding-plans.service'
import { createDefaultFundingSourceCategories } from '../funding-sources/funding-source-defaults'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { createDefaultSupportSteps } from '../support-paths/support-step-defaults'
import { SupportPathsService } from '../support-paths/support-paths.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { NO_PLEDGES } from '../../testing/no-pledges'
import { CandidatureNotesService } from './candidature-notes.service'
import { InterventionJournalService } from './intervention-journal.service'
import { quietNotifications } from '../../testing/notifications'

// ROADMAP E06.08: a workspace's internal notes on a candidature it received — written and read by
// its conseillers alone, rewritten or deleted by their author only, from the version read — and the
// journal of its interventions, read from the histories the earlier tasks keep.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const MARIE = {
  id: 'u-marie',
  email: 'marie@cci.fr',
  role: 'financeur' as const,
  firstName: 'Marie',
  lastName: 'Durand',
}
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

async function failure(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: string; message?: string }
      return { status: err.getStatus(), code: body.code ?? body.message ?? '' }
    }
    throw err
  }
  throw new Error('expected a refusal')
}

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  for (const u of [ADMIN, SOPHIE, MARIE, JEAN, CLAIRE, PAUL]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  for (const [id, name] of [
    [CCI, 'CCI Touraine'],
    [CLUB, 'Club deal'],
  ]) {
    await p.workspace.create({ data: { id, slug: id, name } })
    await createDefaultSupportSteps(p as never, id)
    await createDefaultFundingSourceCategories(p as never, id)
    await createDefaultEligibilitySchemes(p as never, id)
  }
  const member = (workspaceId: string, userId: string, role: string) =>
    p.workspaceMembership.create({
      data: { workspaceId, userId, role, canManageWorkspace: false, deactivatedAt: null },
    })
  await member(CCI, MARIE.id, 'conseiller')
  await member(CCI, JEAN.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  await member(CLUB, PAUL.id, 'conseiller')

  const prisma = p as never
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const dossiers = new DossiersService(
    prisma,
    questionnaires,
    { evaluate: jest.fn().mockResolvedValue(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const candidatures = new CandidaturesService(
    prisma,
    dossiers,
    new WorkspaceAccessService(prisma),
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
    quietNotifications(prisma),
  )
  const journal = new InterventionJournalService(prisma, candidatures)
  const notes = new CandidatureNotesService(prisma, candidatures, journal, audit)

  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  // A draft to the CCI, sent to the club.
  const toCci = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CCI, formVersionId: 'v', submittedAt: null },
  })
  const toClub = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CLUB, formVersionId: 'v', submittedAt: new Date() },
  })
  const send = () =>
    p.candidature.update({ where: { id: toCci.id }, data: { submittedAt: new Date() } })
  const write = (actor: { id: string; role: string }, body: string, workspaceId = CCI) =>
    notes.create(actor, workspaceId, workspaceId === CCI ? toCci.id : toClub.id, { body })
  const noteRows = () => [...fake.table('candidatureNote').values()]
  const noteJournal = () =>
    [...fake.table('auditLog').values()].filter((e) => e.actionType === 'candidature_note_updated')
  return {
    fake,
    p,
    audit,
    candidatures,
    journal,
    notes,
    dossier,
    toCci,
    toClub,
    send,
    write,
    noteRows,
    noteJournal,
  }
}

const notesOf = (view: Awaited<ReturnType<InterventionJournalService['get']>>) =>
  view.entries.flatMap((e) => (e.kind === 'note' ? [e] : []))

describe('CandidatureNotesService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  it('lets the workspace’s conseillers and administrators write and read notes on a sent candidature only', async () => {
    // A draft stays its owner's: no note, no journal.
    expect(await failure(s.write(MARIE, 'Premier échange.'))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    await s.send()
    const view = await s.write(MARIE, 'Premier échange.')
    expect(notesOf(view)).toEqual([
      {
        kind: 'note',
        id: `note:${s.noteRows()[0].id}`,
        at: expect.any(String),
        actor: { email: MARIE.email, firstName: 'Marie', lastName: 'Durand' },
        note: {
          id: s.noteRows()[0].id,
          body: 'Premier échange.',
          version: 1,
          createdAt: expect.any(String),
          editedAt: null,
          deletedAt: null,
          mine: true,
        },
      },
    ])
    expect(s.noteRows()[0]).toMatchObject({ workspaceId: CCI, authorId: MARIE.id })
    // Another conseiller and an administrator read it, theirs to write too.
    expect(notesOf(await s.journal.get(JEAN, CCI, s.toCci.id))[0].note.mine).toBe(false)
    expect(notesOf(await s.write(ADMIN, 'Vu en comité.'))).toHaveLength(2)
  })

  it('refuses an investor of the workspace, another workspace’s conseiller and the owner of the request', async () => {
    await s.send()
    await s.write(MARIE, 'Confidentiel.')
    const id = s.noteRows()[0].id
    expect(await failure(s.journal.get(CLAIRE, CCI, s.toCci.id))).toEqual({
      status: 403,
      code: 'CANDIDATURES_FORBIDDEN',
    })
    expect(await failure(s.write(CLAIRE, 'x'))).toEqual({
      status: 403,
      code: 'CANDIDATURES_FORBIDDEN',
    })
    for (const outsider of [PAUL, SOPHIE]) {
      expect(await failure(s.journal.get(outsider, CCI, s.toCci.id))).toMatchObject({
        status: 404,
      })
      expect(await failure(s.write(outsider, 'x'))).toMatchObject({ status: 404 })
      expect(
        await failure(s.notes.edit(outsider, CCI, s.toCci.id, id, { body: 'x', version: 1 })),
      ).toMatchObject({ status: 404 })
    }
    // The club's conseiller, in its own workspace, does not reach the CCI's candidature.
    expect(await failure(s.journal.get(PAUL, CLUB, s.toCci.id))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    expect(await failure(s.notes.remove(PAUL, CLUB, s.toCci.id, id, 1))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    // Each workspace's notes stay its own.
    await s.write(PAUL, 'Note du club.', CLUB)
    expect(notesOf(await s.journal.get(MARIE, CCI, s.toCci.id)).map((e) => e.note.body)).toEqual([
      'Confidentiel.',
    ])
    expect(notesOf(await s.journal.get(PAUL, CLUB, s.toClub.id)).map((e) => e.note.body)).toEqual([
      'Note du club.',
    ])
    // A note of the club, named on the CCI's candidature: unknown there.
    const clubNote = s.noteRows().find((n) => n.workspaceId === CLUB)!
    expect(
      await failure(s.notes.edit(PAUL, CLUB, s.toCci.id, clubNote.id, { body: 'x', version: 1 })),
    ).toMatchObject({ status: 404 })
    expect(await failure(s.notes.remove(MARIE, CCI, s.toCci.id, clubNote.id, 1))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOTE_NOT_FOUND',
    })
  })

  it('lets only its author rewrite or delete a note, from the version read; a deleted note keeps its trace without its text', async () => {
    await s.send()
    await s.write(MARIE, 'Brouillon de note.')
    const id = s.noteRows()[0].id
    const edit = (actor: { id: string; role: string }, body: string, version: number) =>
      s.notes.edit(actor, CCI, s.toCci.id, id, { body, version })
    for (const other of [JEAN, ADMIN]) {
      expect(await failure(edit(other, 'Réécrite.', 1))).toEqual({
        status: 403,
        code: 'CANDIDATURE_NOTE_NOT_AUTHOR',
      })
      expect(await failure(s.notes.remove(other, CCI, s.toCci.id, id, 1))).toEqual({
        status: 403,
        code: 'CANDIDATURE_NOTE_NOT_AUTHOR',
      })
    }
    // The same text writes nothing.
    await edit(MARIE, 'Brouillon de note.', 1)
    expect(s.noteRows()[0]).toMatchObject({ version: 1, editedAt: null })
    const edited = notesOf(await edit(MARIE, 'Note relue.', 1))[0].note
    expect(edited).toMatchObject({ body: 'Note relue.', version: 2, editedAt: expect.any(String) })
    // From a version already replaced: refused, nothing overwritten.
    expect(await failure(edit(MARIE, 'Autre texte.', 1))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOTE_CHANGED',
    })
    expect(await failure(s.notes.remove(MARIE, CCI, s.toCci.id, id, 1))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOTE_CHANGED',
    })
    expect(s.noteRows()[0].body).toBe('Note relue.')
    const removed = notesOf(await s.notes.remove(MARIE, CCI, s.toCci.id, id, 2))[0]
    expect(removed).toMatchObject({
      actor: { email: MARIE.email },
      note: { body: null, version: 3, deletedAt: expect.any(String) },
    })
    expect(s.noteRows()[0]).toMatchObject({ body: null, deletedAt: expect.any(Date) })
    expect(await failure(edit(MARIE, 'Encore.', 3))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOTE_DELETED',
    })
    expect(await failure(s.notes.remove(MARIE, CCI, s.toCci.id, id, 3))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOTE_DELETED',
    })
    // Journaled without the text.
    expect(
      s.noteJournal().map((e) => [e.actorId, (e.metadata as { change: string }).change]),
    ).toEqual([
      [MARIE.id, 'created'],
      [MARIE.id, 'edited'],
      [MARIE.id, 'deleted'],
    ])
    expect(JSON.stringify(s.noteJournal())).not.toMatch(/Brouillon|relue/)
  })

  it('stops the author whose membership is deactivated, at the next request', async () => {
    await s.send()
    await s.write(JEAN, 'Note de Jean.')
    const id = s.noteRows()[0].id
    const membership = [...s.fake.table('workspaceMembership').values()].find(
      (m) => m.userId === JEAN.id,
    )!
    await s.p.workspaceMembership.update({
      where: { id: membership.id },
      data: { deactivatedAt: new Date() },
    })
    expect(
      await failure(s.notes.edit(JEAN, CCI, s.toCci.id, id, { body: 'x', version: 1 })),
    ).toMatchObject({ status: 404 })
    // Kept for the structure, by its author's name.
    expect(notesOf(await s.journal.get(MARIE, CCI, s.toCci.id))[0]).toMatchObject({
      actor: { email: JEAN.email },
      note: { body: 'Note de Jean.', mine: false },
    })
  })

  it('caps a candidature’s notes', async () => {
    await s.send()
    for (let i = 0; i < 500; i++) {
      await s.p.candidatureNote.create({
        data: { candidatureId: s.toCci.id, workspaceId: CCI, body: `n${i}`, authorId: JEAN.id },
      })
    }
    expect(await failure(s.write(MARIE, 'Une de trop.'))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOTE_LIMIT',
    })
  })

  it('keeps the notes’ journal entries out of the owner’s history, not out of the administrators’', async () => {
    await s.send()
    await s.write(MARIE, 'Confidentiel.')
    expect(ownerRule('candidature_note_updated')).toBeNull()
    expect(actionsFor('all')).not.toContain('candidature_note_updated')
    const admin = await new AuditLogService(s.p as never).listForAdmin(s.dossier.id)
    expect(admin.map((e) => e.actionType)).toContain('candidature_note_updated')
  })
})

describe('InterventionJournalService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
    await s.send()
  })

  it('lists the structure’s interventions — notes, statuses, plan lines, eligibilities, steps — the latest first, and none of the entrepreneur’s', async () => {
    const prisma = s.p as never
    const plans = new FundingPlansService(prisma, s.candidatures, NO_PLEDGES, s.audit)
    const eligibilities = new EligibilitiesService(prisma, s.candidatures, s.audit)
    const paths = new SupportPathsService(prisma, s.candidatures, s.audit)
    const ws = { side: 'workspace' as const, actor: MARIE, workspaceId: CCI }
    const owner = { side: 'owner' as const, userId: SOPHIE.id }
    const category = async (key: string) =>
      (await s.p.fundingSourceCategory.findFirst({ where: { workspaceId: CCI, key } }))!
    const scheme = async (key: string) =>
      (await s.p.eligibilityScheme.findFirst({ where: { workspaceId: CCI, key } }))!
    const tick = () => new Promise((r) => setTimeout(r, 2))

    // The entrepreneur's own actions: not the structure's interventions.
    await plans.addLine(owner, s.toCci.id, {
      categoryId: (await category('pret_honneur')).id,
      amountEur: 30_000,
      state: 'planned',
    })
    await eligibilities.declare(owner, s.toCci.id, { schemeId: (await scheme('jei')).id })
    await s.p.candidatureStatusChange.create({
      data: {
        candidatureId: s.toCci.id,
        fromStatus: 'preparing',
        toStatus: 'abandoned',
        actorSide: 'owner',
        actorId: SOPHIE.id,
        changedAt: new Date(),
      },
    })
    await tick()
    const bpi = await category('bpifrance')
    const added = await plans.addLine(ws, s.toCci.id, {
      categoryId: bpi.id,
      amountEur: 50_000,
      state: 'requested',
      label: 'Bourse French Tech',
    })
    const line = added.lines.find((l) => l.category.id === bpi.id)!
    await tick()
    await plans.updateLine(ws, s.toCci.id, line.id, { version: 1, state: 'obtained' })
    await tick()
    const jeiScheme = await scheme('jei')
    const declared = await eligibilities.declare(ws, s.toCci.id, {
      schemeId: (await scheme('jeir')).id,
      verified: true,
    })
    await tick()
    const jei = declared.eligibilities.find((e) => e.scheme.id === jeiScheme.id)!
    await eligibilities.update(ws, s.toCci.id, jei.id, { version: jei.version, verified: true })
    await tick()
    const pitch = (await s.p.supportStep.findFirst({ where: { workspaceId: CCI, key: 'pitch' } }))!
    await paths.setValidation(JEAN, CCI, s.toCci.id, pitch.id, { validated: true, version: 0 })
    await tick()
    await s.p.candidatureStatusChange.create({
      data: {
        candidatureId: s.toCci.id,
        fromStatus: 'abandoned',
        toStatus: 'in_committee',
        actorSide: 'workspace',
        actorId: JEAN.id,
        changedAt: new Date(),
      },
    })
    await tick()
    await plans.deleteLine(ws, s.toCci.id, line.id, 2)
    await tick()
    await s.write(MARIE, 'Dossier solide.')
    // The club's interventions on its own candidature stay out.
    await plans.addLine({ side: 'workspace', actor: PAUL, workspaceId: CLUB }, s.toClub.id, {
      categoryId: (await s.p.fundingSourceCategory.findFirst({ where: { workspaceId: CLUB } }))!.id,
      amountEur: 1_000,
      state: 'planned',
    })

    const view = await s.journal.get(JEAN, CCI, s.toCci.id)
    // Who, and what — the keys and dates aside.
    const strip = (entry: (typeof view.entries)[number]) => {
      const rest: Record<string, unknown> = { ...entry }
      delete rest.id
      delete rest.at
      delete rest.actor
      return { by: entry.actor?.email ?? null, ...rest }
    }
    expect(view.entries.map(strip)).toEqual([
      {
        by: MARIE.email,
        kind: 'note',
        note: expect.objectContaining({ body: 'Dossier solide.', mine: false }),
      },
      {
        by: MARIE.email,
        kind: 'funding_plan',
        change: 'deleted',
        category: 'Bpifrance',
        line: { label: 'Bourse French Tech', amountEur: 50_000, state: 'obtained' },
        changes: [],
      },
      { by: JEAN.email, kind: 'financing_status', from: 'abandoned', to: 'in_committee' },
      {
        by: JEAN.email,
        kind: 'support_step',
        step: { id: pitch.id, label: 'Pitch' },
        change: 'validated',
      },
      {
        by: MARIE.email,
        kind: 'eligibility',
        change: 'updated',
        scheme: 'JEI',
        verified: true,
        noteChanged: false,
      },
      {
        by: MARIE.email,
        kind: 'eligibility',
        change: 'declared',
        scheme: 'JEIR',
        verified: true,
        noteChanged: false,
      },
      {
        by: MARIE.email,
        kind: 'funding_plan',
        change: 'updated',
        category: 'Bpifrance',
        line: null,
        changes: [{ field: 'state', from: 'requested', to: 'obtained' }],
      },
      {
        by: MARIE.email,
        kind: 'funding_plan',
        change: 'created',
        category: 'Bpifrance',
        line: { label: 'Bourse French Tech', amountEur: 50_000, state: 'requested' },
        changes: [],
      },
    ])
    expect(new Set(view.entries.map((e) => e.id)).size).toBe(view.entries.length)
  })

  it('leaves out a journal entry it does not understand rather than guessing', async () => {
    await s.audit.record({
      actionType: 'funding_plan_updated',
      actorId: MARIE.id,
      dossierId: s.dossier.id,
      metadata: { candidatureId: s.toCci.id, side: 'workspace', change: 'exploded' },
    })
    await s.audit.record({
      actionType: 'candidature_eligibility_updated',
      actorId: MARIE.id,
      dossierId: s.dossier.id,
      metadata: { candidatureId: s.toCci.id, side: 'admin', change: 'declared' },
    })
    expect((await s.journal.get(MARIE, CCI, s.toCci.id)).entries).toEqual([])
  })
})
