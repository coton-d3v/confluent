import { HttpException } from '@nestjs/common'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService, type CandidatureParty } from '../candidatures/candidatures.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { EligibilitiesService } from './eligibilities.service'
import { createDefaultEligibilitySchemes } from './eligibility-scheme-defaults'
import { quietNotifications } from '../../testing/notifications'

// ROADMAP E06.05: who keeps a candidature's eligibilities — its owner, and once sent the conseillers
// of its workspace, who alone verify —, nobody else; every write checked again under the
// candidature's lock; an eligibility changed meanwhile never overwritten; the received candidatures
// filtered by scheme within the workspace only.
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const LEA = { id: 'u-lea', email: 'lea@autre.fr', role: 'entrepreneur' as const }
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
const JEAN = { id: 'u-jean', email: 'jean@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

const owner = (u: { id: string }): CandidatureParty => ({ side: 'owner', userId: u.id })
const inWs = (u: { id: string; role: string }, workspaceId = CCI): CandidatureParty => ({
  side: 'workspace',
  actor: u,
  workspaceId,
})

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
  for (const u of [ADMIN, SOPHIE, LEA, MARIE, JEAN, CLAIRE, PAUL]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  for (const [id, name] of [
    [CCI, 'CCI Touraine'],
    [CLUB, 'Club deal'],
  ]) {
    await p.workspace.create({ data: { id, slug: id, name } })
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
  const eligibilities = new EligibilitiesService(prisma, candidatures, audit)

  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  // Candidatures made as the candidatures' service leaves them: a draft to the CCI, sent to the club.
  const toCci = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CCI, formVersionId: 'v', submittedAt: null },
  })
  const toClub = await p.candidature.create({
    data: { dossierId: dossier.id, workspaceId: CLUB, formVersionId: 'v', submittedAt: new Date() },
  })
  const send = () =>
    p.candidature.update({ where: { id: toCci.id }, data: { submittedAt: new Date() } })
  const scheme = async (workspaceId: string, key: string) =>
    (await p.eligibilityScheme.findFirst({ where: { workspaceId, key } }))!
  const journal = () =>
    [...fake.table('auditLog').values()].filter(
      (e) => e.actionType === 'candidature_eligibility_updated',
    )
  return {
    fake,
    p,
    candidatures,
    eligibilities,
    dossiers,
    dossier,
    toCci,
    toClub,
    send,
    scheme,
    journal,
  }
}

describe('EligibilitiesService', () => {
  let s: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    s = await setup()
  })

  const declare = (party: CandidatureParty, candidatureId: string, schemeId: string, extra = {}) =>
    s.eligibilities.declare(party, candidatureId, { schemeId, ...extra })

  it('lets the owner declare on a draft candidature, which the workspace reaches once sent', async () => {
    const jei = await s.scheme(CCI, 'jei')
    const view = await declare(owner(SOPHIE), s.toCci.id, jei.id, { note: 'Rescrit 2025' })
    expect(view.eligibilities).toEqual([
      expect.objectContaining({
        note: 'Rescrit 2025',
        declaredBy: 'owner',
        verifiedAt: null,
        version: 1,
        updatedBy: 'owner',
      }),
    ])
    expect(view.schemes.map((x) => x.key)).toEqual(['jeir', 'cir', 'cii', 'ir_pme'])
    expect(await failure(s.eligibilities.get(inWs(MARIE), s.toCci.id))).toEqual({
      status: 404,
      code: 'CANDIDATURE_NOT_FOUND',
    })
    await s.send()
    expect((await s.eligibilities.get(inWs(MARIE), s.toCci.id)).eligibilities).toHaveLength(1)
  })

  it('opens the workspace side to its active conseillers and administrators only', async () => {
    await s.send()
    const jei = await s.scheme(CCI, 'jei')
    const cir = await s.scheme(CCI, 'cir')
    await declare(inWs(JEAN), s.toCci.id, jei.id)
    await declare(inWs(ADMIN), s.toCci.id, cir.id)
    const jeir = (await s.scheme(CCI, 'jeir')).id
    expect(await failure(declare(inWs(CLAIRE), s.toCci.id, jeir))).toMatchObject({ status: 403 })
    expect(await failure(s.eligibilities.get(inWs(CLAIRE), s.toCci.id))).toMatchObject({
      status: 403,
    })
    for (const party of [inWs(PAUL), inWs(PAUL, CLUB), inWs(SOPHIE), inWs(LEA)]) {
      expect(await failure(s.eligibilities.get(party, s.toCci.id))).toMatchObject({ status: 404 })
      expect(await failure(declare(party, s.toCci.id, jeir))).toMatchObject({ status: 404 })
    }
    for (const who of [LEA, MARIE, ADMIN]) {
      expect(await failure(s.eligibilities.get(owner(who), s.toCci.id))).toMatchObject({
        status: 404,
      })
    }
    await s.p.workspaceMembership.updateMany({
      where: { userId: JEAN.id },
      data: { deactivatedAt: new Date() },
    })
    expect(await failure(s.eligibilities.get(inWs(JEAN), s.toCci.id))).toMatchObject({
      status: 404,
    })
    expect(s.fake.table('candidatureEligibility').size).toBe(2)
  })

  it('reads the access again under the candidature’s lock: a right lost meanwhile writes nothing', async () => {
    await s.send()
    const jei = await s.scheme(CCI, 'jei')
    s.p.$queryRaw.mockImplementationOnce(async () => {
      await s.p.workspaceMembership.updateMany({
        where: { userId: JEAN.id },
        data: { deactivatedAt: new Date() },
      })
      return []
    })
    expect(await failure(declare(inWs(JEAN), s.toCci.id, jei.id))).toMatchObject({ status: 404 })
    s.p.$queryRaw.mockImplementationOnce(async () => {
      await s.p.dossier.update({ where: { id: s.dossier.id }, data: { userId: LEA.id } })
      return []
    })
    expect(await failure(declare(owner(SOPHIE), s.toCci.id, jei.id))).toMatchObject({
      status: 404,
    })
    expect(s.fake.table('candidatureEligibility').size).toBe(0)
    expect(s.journal()).toHaveLength(0)
  })

  it('lets the workspace alone verify; the owner’s change of note withdraws the verification', async () => {
    await s.send()
    const jei = await s.scheme(CCI, 'jei')
    const [e] = (await declare(owner(SOPHIE), s.toCci.id, jei.id, { verified: true })).eligibilities
    // The owner's `verified` is never applied (the HTTP contract refuses it anyway).
    expect(e.verifiedAt).toBeNull()
    expect(
      (
        await s.eligibilities.update(owner(SOPHIE), s.toCci.id, e.id, {
          version: 1,
          verified: true,
        })
      ).eligibilities[0],
    ).toMatchObject({ verifiedAt: null, version: 1 })
    const verified = (
      await s.eligibilities.update(inWs(JEAN), s.toCci.id, e.id, { version: 1, verified: true })
    ).eligibilities[0]
    expect(verified).toMatchObject({ verifiedAt: expect.any(Date), version: 2 })
    const row = s.fake.table('candidatureEligibility').get(e.id)!
    expect(row).toMatchObject({ verifiedById: JEAN.id, updatedBySide: 'workspace' })
    // The workspace edits the note and keeps its verification.
    const noted = (
      await s.eligibilities.update(inWs(MARIE), s.toCci.id, e.id, { version: 2, note: 'Vu' })
    ).eligibilities[0]
    expect(noted).toMatchObject({ note: 'Vu', verifiedAt: expect.any(Date), version: 3 })
    // The owner edits it: what was verified is no longer what is declared.
    const edited = (
      await s.eligibilities.update(owner(SOPHIE), s.toCci.id, e.id, { version: 3, note: 'Autre' })
    ).eligibilities[0]
    expect(edited).toMatchObject({ note: 'Autre', verifiedAt: null, version: 4 })
    expect(s.fake.table('candidatureEligibility').get(e.id)).toMatchObject({ verifiedById: null })
    // Declared by the workspace, verified at once.
    const cir = await s.scheme(CCI, 'cir')
    const byWs = await declare(inWs(MARIE), s.toCci.id, cir.id, { verified: true })
    expect(byWs.eligibilities[1]).toMatchObject({
      declaredBy: 'workspace',
      verifiedAt: expect.any(Date),
    })
    // The view says which side, never who.
    expect(JSON.stringify(byWs)).not.toMatch(/u-marie|u-jean|u-sophie/)
  })

  it('refuses a change made from a stale version, an eligibility of another candidature, and writes nothing unchanged', async () => {
    await s.send()
    const jei = await s.scheme(CCI, 'jei')
    const [e] = (await declare(owner(SOPHIE), s.toCci.id, jei.id)).eligibilities
    await s.eligibilities.update(inWs(MARIE), s.toCci.id, e.id, { version: 1, verified: true })
    expect(
      await failure(
        s.eligibilities.update(owner(SOPHIE), s.toCci.id, e.id, { version: 1, note: 'x' }),
      ),
    ).toEqual({ status: 409, code: 'ELIGIBILITY_CHANGED' })
    expect(await failure(s.eligibilities.remove(owner(SOPHIE), s.toCci.id, e.id, 1))).toEqual({
      status: 409,
      code: 'ELIGIBILITY_CHANGED',
    })
    expect(
      await failure(
        s.eligibilities.update(owner(SOPHIE), s.toClub.id, e.id, { version: 2, note: null }),
      ),
    ).toEqual({ status: 404, code: 'ELIGIBILITY_NOT_FOUND' })
    expect(await failure(s.eligibilities.remove(inWs(PAUL, CLUB), s.toClub.id, e.id, 2))).toEqual({
      status: 404,
      code: 'ELIGIBILITY_NOT_FOUND',
    })
    const same = await s.eligibilities.update(inWs(JEAN), s.toCci.id, e.id, {
      version: 2,
      note: null,
      verified: true,
    })
    expect(same.eligibilities[0].version).toBe(2)
    expect(s.journal().map((x) => (x.metadata as { change: string }).change)).toEqual([
      'declared',
      'updated',
    ])
    expect(
      (await s.eligibilities.remove(owner(SOPHIE), s.toCci.id, e.id, 2)).eligibilities,
    ).toEqual([])
  })

  it('takes active schemes of the candidature’s workspace only, once each', async () => {
    const jei = await s.scheme(CCI, 'jei')
    await declare(owner(SOPHIE), s.toCci.id, jei.id)
    expect(await failure(declare(owner(SOPHIE), s.toCci.id, jei.id))).toEqual({
      status: 409,
      code: 'ELIGIBILITY_EXISTS',
    })
    // The club's scheme on the CCI's candidature, an unknown one: the same 400.
    for (const id of [(await s.scheme(CLUB, 'jei')).id, 'unknown']) {
      expect(await failure(declare(owner(SOPHIE), s.toCci.id, id))).toEqual({
        status: 400,
        code: 'ELIGIBILITY_SCHEME_UNKNOWN',
      })
    }
    // Deactivated: no new declaration; the existing one stays, offered no more.
    const cir = await s.scheme(CCI, 'cir')
    await s.p.eligibilityScheme.update({ where: { id: jei.id }, data: { active: false } })
    await s.p.eligibilityScheme.update({ where: { id: cir.id }, data: { active: false } })
    expect(await failure(declare(owner(SOPHIE), s.toCci.id, cir.id))).toEqual({
      status: 409,
      code: 'ELIGIBILITY_SCHEME_INACTIVE',
    })
    const view = await s.eligibilities.get(owner(SOPHIE), s.toCci.id)
    expect(view.eligibilities.map((e) => [e.scheme.key, e.scheme.active])).toEqual([['jei', false]])
    expect(view.schemes.map((x) => x.key)).toEqual(['jeir', 'cii', 'ir_pme'])
    expect(s.fake.table('candidatureEligibility').size).toBe(1)
  })

  it('orders eligibilities as the workspace orders its schemes', async () => {
    const ids = await Promise.all(['ir_pme', 'jeir', 'cir'].map((k) => s.scheme(CCI, k)))
    for (const x of ids) await declare(owner(SOPHIE), s.toCci.id, x.id)
    const before = await s.eligibilities.get(owner(SOPHIE), s.toCci.id)
    expect(before.eligibilities.map((e) => e.scheme.key)).toEqual(['jeir', 'cir', 'ir_pme'])
    await s.p.eligibilityScheme.update({ where: { id: ids[0].id }, data: { position: -1 } })
    const after = await s.eligibilities.get(owner(SOPHIE), s.toCci.id)
    expect(after.eligibilities.map((e) => e.scheme.key)).toEqual(['ir_pme', 'jeir', 'cir'])
  })

  it('journals each change with its side, author, request and candidature', async () => {
    await s.send()
    const jei = await s.scheme(CCI, 'jei')
    const [e] = (await declare(owner(SOPHIE), s.toCci.id, jei.id, { note: 'A' })).eligibilities
    await s.eligibilities.update(inWs(JEAN), s.toCci.id, e.id, { version: 1, verified: true })
    await s.eligibilities.remove(inWs(MARIE), s.toCci.id, e.id, 2)
    expect(
      s
        .journal()
        .map((x) => ({ actorId: x.actorId, dossierId: x.dossierId, ...(x.metadata as object) })),
    ).toEqual([
      expect.objectContaining({
        actorId: SOPHIE.id,
        dossierId: s.dossier.id,
        candidatureId: s.toCci.id,
        workspaceId: CCI,
        side: 'owner',
        change: 'declared',
        scheme: 'jei',
        note: 'A',
        verified: false,
      }),
      expect.objectContaining({
        actorId: JEAN.id,
        side: 'workspace',
        change: 'updated',
        changes: [{ field: 'verified', from: false, to: true }],
      }),
      expect.objectContaining({
        actorId: MARIE.id,
        change: 'removed',
        scheme: 'jei',
        verified: true,
      }),
    ])
  })

  describe('received candidatures filtered by scheme (CandidaturesService.listReceived)', () => {
    it('lists each candidature’s eligibilities and filters by scheme, verification and status, within the workspace', async () => {
      await s.send()
      // Another request of Léa, sent to the CCI, in committee.
      const other = await s.dossiers.create({ owner: LEA, name: 'Agrotech' })
      const lea = await s.p.candidature.create({
        data: {
          dossierId: other.id,
          workspaceId: CCI,
          formVersionId: 'v',
          submittedAt: new Date(),
          financingStatus: 'in_committee',
        },
      })
      const jeir = await s.scheme(CCI, 'jeir')
      const jei = await s.scheme(CCI, 'jei')
      await declare(owner(SOPHIE), s.toCci.id, jei.id)
      await declare(inWs(MARIE), s.toCci.id, jeir.id, { verified: true })
      await declare(owner(LEA), lea.id, jei.id)
      // At the club, Sophie declares the club's JEIR.
      const clubJeir = await s.scheme(CLUB, 'jeir')
      await declare(owner(SOPHIE), s.toClub.id, clubJeir.id)

      const list = (filter = {}) => s.candidatures.listReceived(MARIE, CCI, filter)
      const names = async (filter = {}) => (await list(filter)).map((c) => c.dossier.name).sort()
      const all = await list()
      expect(
        Object.fromEntries(
          all.map((c) => [c.dossier.name, c.eligibilities.map((e) => [e.label, e.verified])]),
        ),
      ).toEqual({
        Biosensio: [
          ['JEIR', true],
          ['JEI', false],
        ],
        Agrotech: [['JEI', false]],
      })
      expect(await names({ scheme: jeir.id })).toEqual(['Biosensio'])
      expect(await names({ scheme: jei.id })).toEqual(['Agrotech', 'Biosensio'])
      expect(await names({ scheme: jei.id, verified: true })).toEqual([])
      expect(await names({ verified: true })).toEqual(['Biosensio'])
      expect(await names({ financingStatus: 'in_committee', scheme: jei.id })).toEqual(['Agrotech'])
      expect(await names({ financingStatus: 'funded' })).toEqual([])
      // The club's scheme matches nothing at the CCI, though Sophie declared it there.
      expect(await names({ scheme: clubJeir.id })).toEqual([])
      // The club lists only its own eligibilities.
      const club = await s.candidatures.listReceived(PAUL, CLUB)
      expect(club.map((c) => c.eligibilities.map((e) => e.label))).toEqual([['JEIR']])
      expect(
        await failure(s.candidatures.listReceived(CLAIRE, CCI, { scheme: jeir.id })),
      ).toMatchObject({
        status: 403,
      })
      expect(
        await failure(s.candidatures.listReceived(PAUL, CCI, { scheme: jeir.id })),
      ).toMatchObject({
        status: 404,
      })
    })
  })
})
