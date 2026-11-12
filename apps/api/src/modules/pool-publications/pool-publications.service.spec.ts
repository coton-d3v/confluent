import { HttpException } from '@nestjs/common'
import { poolPublicationSchema } from '@confluent/shared'
import { createFakePrisma } from '../../testing/fake-prisma'
import { AnswerSourcesService } from '../answers/answer-sources.service'
import { AuditService } from '../audit/audit.service'
import { CandidaturesService } from '../candidatures/candidatures.service'
import type { ClassificationService } from '../classification/classification.service'
import { CompaniesService } from '../companies/companies.service'
import type { DocumentsService } from '../documents/documents.service'
import { DossiersService } from '../dossiers/dossiers.service'
import { QuestionnairesService } from '../questionnaires/questionnaires.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access'
import { PoolPublicationsService } from './pool-publications.service'
import { quietNotifications } from '../../testing/notifications'

// ROADMAP E07.02: a request published in a workspace's pool by its owner's explicit consent, per
// (request × workspace); withdrawn from that workspace only — never another's, a share, the
// candidature or the request's publication —; paused while the request is not published or its
// follow-up closed; withdrawn everywhere by the archiving.
const SOPHIE = { id: 'u-sophie', email: 'sophie@biosensio.fr', role: 'entrepreneur' as const }
const MARC = { id: 'u-marc', email: 'marc@agrotech.fr', role: 'entrepreneur' as const }
const MARIE = { id: 'u-marie', email: 'marie@cci.fr', role: 'financeur' as const }
const CLAIRE = { id: 'u-claire', email: 'claire@angels.fr', role: 'financeur' as const }
const PAUL = { id: 'u-paul', email: 'paul@club.fr', role: 'financeur' as const }
const ADMIN = { id: 'u-admin', email: 'admin@confluent.dev', role: 'admin' as const }
const CCI = 'ws-cci'
const CLUB = 'ws-club'

async function setup() {
  const fake = createFakePrisma()
  const p = fake.prisma
  for (const u of [SOPHIE, MARC, MARIE, CLAIRE, PAUL, ADMIN]) {
    await p.user.create({ data: { ...u, emailVerifiedAt: new Date() } })
  }
  for (const [id, name] of [
    [CCI, 'CCI Touraine'],
    [CLUB, 'Club deal'],
  ]) {
    await p.workspace.create({ data: { id, slug: id, name, programName: null, color: null } })
    await p.questionnaire.create({
      data: { id: `f-${id}`, slug: `f-${id}`, name: 'Formulaire', workspaceId: id, usage: 'x' },
    })
    await p.questionnaireVersion.create({
      data: { id: `v-${id}`, questionnaireId: `f-${id}`, version: 1, status: 'published' },
    })
  }
  const member = (workspaceId: string, userId: string, role: string) =>
    p.workspaceMembership.create({ data: { workspaceId, userId, role } })
  await member(CCI, MARIE.id, 'conseiller')
  await member(CCI, CLAIRE.id, 'investisseur')
  await member(CLUB, PAUL.id, 'conseiller')

  const prisma = p as never
  const audit = new AuditService(prisma)
  const workspaces = new WorkspaceAccessService(prisma)
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
    workspaces,
    questionnaires,
    new AnswerSourcesService(prisma, {} as DocumentsService),
    audit,
    quietNotifications(prisma),
  )
  const pool = new PoolPublicationsService(prisma, candidatures, dossiers, audit)

  // Sophie's request, published, sent to both workspaces, shared with a financeur.
  const dossier = await dossiers.create({ owner: SOPHIE, name: 'Biosensio' })
  await p.dossier.update({
    where: { id: dossier.id },
    data: { submittedAt: new Date(), publicationStatus: 'published', publishedAt: new Date() },
  })
  const sent = (workspaceId: string) =>
    p.candidature.create({
      data: {
        dossierId: dossier.id,
        workspaceId,
        formVersionId: `v-${workspaceId}`,
        submittedAt: new Date(),
      },
    })
  const cci = await sent(CCI)
  const club = await sent(CLUB)
  const share = await p.shareLink.create({
    data: {
      dossierId: dossier.id,
      recipientEmail: 'bob@banque.fr',
      token: 'tok',
      status: 'active',
      accessLevel: 'partiel',
    },
  })
  const rows = () => [...fake.table('poolPublication').values()]
  const journal = () =>
    [...fake.table('auditLog').values()].filter((a) =>
      String(a.actionType).startsWith('pool_publication_'),
    )
  return { fake, p, dossiers, candidatures, pool, dossier, cci, club, share, rows, journal }
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), code: (err.getResponse() as { code?: unknown }).code }
    }
    throw err
  }
  throw new Error('expected a refusal')
}

const consent = (accessLevel: 'public' | 'partiel' | 'complet') =>
  ({ accessLevel, consent: true }) as const

describe('PoolPublicationsService (E07.02)', () => {
  it('publishes in one workspace’s pool by the owner’s consent, dated and journaled, and nowhere else', async () => {
    const { pool, cci, club, rows, journal, candidatures } = await setup()
    const view = await pool.publish(cci.id, SOPHIE.id, consent('partiel'))
    expect(view.poolPublication).toMatchObject({
      accessLevel: 'partiel',
      state: 'listed',
      pausedBecause: null,
      withdrawnAt: null,
      withdrawnBecause: null,
    })
    expect(
      poolPublicationSchema.safeParse(JSON.parse(JSON.stringify(view.poolPublication))).success,
    ).toBe(true)
    expect(rows()).toEqual([
      expect.objectContaining({
        candidatureId: cci.id,
        workspaceId: CCI,
        accessLevel: 'partiel',
        consentedById: SOPHIE.id,
        consentedAt: expect.any(Date),
      }),
    ])
    expect(journal()).toEqual([
      expect.objectContaining({
        actionType: 'pool_publication_published',
        actorId: SOPHIE.id,
        metadata: expect.objectContaining({
          candidatureId: cci.id,
          workspaceId: CCI,
          from: null,
          to: 'partiel',
          republished: false,
          channel: 'site',
        }),
      }),
    ])
    // The other workspace's candidature: never published there.
    expect((await candidatures.getForOwner(club.id, SOPHIE.id)).poolPublication).toBeNull()
    // The same level again changes nothing, not even the journal.
    await pool.publish(cci.id, SOPHIE.id, consent('partiel'))
    expect(journal()).toHaveLength(1)
  })

  it('refuses whoever is not the owner of the request — another entrepreneur, a conseiller, an investor, an administrator — with the 404 of an unknown candidature', async () => {
    const { pool, cci, rows } = await setup()
    for (const someone of [MARC, MARIE, CLAIRE, PAUL, ADMIN]) {
      expect(await failure(pool.publish(cci.id, someone.id, consent('public')))).toEqual({
        status: 404,
        code: 'CANDIDATURE_NOT_FOUND',
      })
    }
    await pool.publish(cci.id, SOPHIE.id, consent('public'))
    for (const someone of [MARC, MARIE, CLAIRE, PAUL, ADMIN]) {
      expect(await failure(pool.withdraw(cci.id, someone.id))).toEqual({
        status: 404,
        code: 'CANDIDATURE_NOT_FOUND',
      })
    }
    expect(rows()[0]).toMatchObject({ withdrawnAt: null })
  })

  it('needs the candidature sent, the request published and its follow-up open in that workspace', async () => {
    const { p, pool, cci, dossier, rows } = await setup()
    await p.candidature.update({ where: { id: cci.id }, data: { submittedAt: null } })
    expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('public')))).toEqual({
      status: 409,
      code: 'CANDIDATURE_NOT_SENT',
    })
    await p.candidature.update({ where: { id: cci.id }, data: { submittedAt: new Date() } })
    await p.dossier.update({
      where: { id: dossier.id },
      data: { publicationStatus: 'draft', publishedAt: null },
    })
    expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('public')))).toEqual({
      status: 409,
      code: 'DOSSIER_NOT_PUBLISHED',
    })
    await p.dossier.update({ where: { id: dossier.id }, data: { publicationStatus: 'archived' } })
    expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('public')))).toEqual({
      status: 409,
      code: 'DOSSIER_ARCHIVED',
    })
    await p.dossier.update({ where: { id: dossier.id }, data: { publicationStatus: 'published' } })
    for (const closed of ['funded', 'refused', 'abandoned', 'unknown']) {
      await p.candidature.update({ where: { id: cci.id }, data: { financingStatus: closed } })
      expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('public')))).toEqual({
        status: 409,
        code: 'FINANCING_CLOSED',
      })
    }
    expect(rows()).toEqual([])
    await p.candidature.update({ where: { id: cci.id }, data: { financingStatus: 'in_committee' } })
    await pool.publish(cci.id, SOPHIE.id, consent('public'))
    expect(rows()).toHaveLength(1)
  })

  it('refuses a company prepared by a conseiller: only its entrepreneur diffuses it', async () => {
    const { p, pool, cci, dossier, rows } = await setup()
    await p.company.update({
      where: { id: dossier.companyId },
      data: { preparedInWorkspaceId: CCI },
    })
    await p.workspaceMembership.create({
      data: { workspaceId: CCI, userId: SOPHIE.id, role: 'conseiller' },
    })
    expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('public')))).toMatchObject({
      status: 409,
    })
    expect(rows()).toEqual([])
  })

  it('widens only while publishable, narrows always, and journals both levels', async () => {
    const { p, pool, cci, rows, journal } = await setup()
    await pool.publish(cci.id, SOPHIE.id, consent('partiel'))
    await p.candidature.update({ where: { id: cci.id }, data: { financingStatus: 'funded' } })
    expect(await failure(pool.publish(cci.id, SOPHIE.id, consent('complet')))).toEqual({
      status: 409,
      code: 'FINANCING_CLOSED',
    })
    const narrowed = await pool.publish(cci.id, SOPHIE.id, consent('public'))
    expect(narrowed.poolPublication).toMatchObject({
      accessLevel: 'public',
      state: 'paused',
      pausedBecause: 'financing_closed',
    })
    expect(rows()).toHaveLength(1)
    expect(journal().map((e) => e.metadata)).toEqual([
      expect.objectContaining({ from: null, to: 'partiel' }),
      expect.objectContaining({ from: 'partiel', to: 'public', republished: false }),
    ])
    // The follow-up reopened: listed again, without a new consent.
    await p.candidature.update({ where: { id: cci.id }, data: { financingStatus: 'preparing' } })
    const reopened = await pool.publish(cci.id, SOPHIE.id, consent('public'))
    expect(reopened.poolPublication?.state).toBe('listed')
  })

  it('withdraws from that workspace only: the other pool, the shares, the candidatures and the request stay as they are', async () => {
    const { p, pool, cci, club, share, dossier, rows, journal, candidatures } = await setup()
    await pool.publish(cci.id, SOPHIE.id, consent('partiel'))
    await pool.publish(club.id, SOPHIE.id, consent('complet'))
    const before = {
      share: { ...(await p.shareLink.findUnique({ where: { id: share.id } })) },
      dossier: { ...(await p.dossier.findUnique({ where: { id: dossier.id } })) },
      candidatures: await p.candidature.findMany({ where: { dossierId: dossier.id } }),
    }
    const view = await pool.withdraw(cci.id, SOPHIE.id)
    expect(view.poolPublication).toMatchObject({
      accessLevel: 'partiel',
      state: 'withdrawn',
      withdrawnAt: expect.any(Date),
      withdrawnBecause: 'owner',
    })
    expect(rows().find((r) => r.candidatureId === club.id)).toMatchObject({
      withdrawnAt: null,
      accessLevel: 'complet',
    })
    expect((await candidatures.getForOwner(club.id, SOPHIE.id)).poolPublication?.state).toBe(
      'listed',
    )
    expect(await p.shareLink.findUnique({ where: { id: share.id } })).toEqual(before.share)
    expect(await p.dossier.findUnique({ where: { id: dossier.id } })).toEqual(before.dossier)
    expect(await p.candidature.findMany({ where: { dossierId: dossier.id } })).toEqual(
      before.candidatures,
    )
    expect(journal().at(-1)).toMatchObject({
      actionType: 'pool_publication_withdrawn',
      metadata: {
        candidatureId: cci.id,
        workspaceId: CCI,
        accessLevel: 'partiel',
        reason: 'owner',
      },
    })
    // Again, or never published: nothing changes.
    await pool.withdraw(cci.id, SOPHIE.id)
    expect(journal()).toHaveLength(3)

    // Published again: a new consent on the same row.
    const again = await pool.publish(cci.id, SOPHIE.id, consent('public'))
    expect(again.poolPublication).toMatchObject({
      state: 'listed',
      accessLevel: 'public',
      withdrawnAt: null,
      withdrawnBecause: null,
    })
    expect(rows()).toHaveLength(2)
    expect(journal().at(-1)?.metadata).toMatchObject({
      from: null,
      to: 'public',
      republished: true,
    })
  })

  it('pauses while the request is unpublished, and withdraws everywhere when it is archived — not restored by unarchiving', async () => {
    const { pool, dossiers, cci, club, dossier, share, p, journal, candidatures } = await setup()
    await pool.publish(cci.id, SOPHIE.id, consent('partiel'))
    await pool.publish(club.id, SOPHIE.id, consent('public'))
    await dossiers.unpublish(dossier.id, SOPHIE.id)
    for (const c of [cci, club]) {
      expect((await candidatures.getForOwner(c.id, SOPHIE.id)).poolPublication).toMatchObject({
        state: 'paused',
        pausedBecause: 'request_not_published',
      })
    }
    // Narrowing while paused is possible; widening is not.
    expect(await failure(pool.publish(club.id, SOPHIE.id, consent('complet')))).toEqual({
      status: 409,
      code: 'DOSSIER_NOT_PUBLISHED',
    })
    await dossiers.archive(dossier.id, SOPHIE.id)
    for (const c of [cci, club]) {
      expect((await candidatures.getForOwner(c.id, SOPHIE.id)).poolPublication).toMatchObject({
        state: 'withdrawn',
        withdrawnBecause: 'archived',
      })
    }
    expect(journal().filter((e) => e.actionType === 'pool_publication_withdrawn')).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'archived' }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'archived' }) }),
    ])
    // The shares stay open.
    expect(await p.shareLink.findUnique({ where: { id: share.id } })).toMatchObject({
      status: 'active',
    })
    await dossiers.unarchive(dossier.id, SOPHIE.id)
    expect((await candidatures.getForOwner(cci.id, SOPHIE.id)).poolPublication?.state).toBe(
      'withdrawn',
    )
  })

  it('shows the workspace’s conseillers where it stands on the candidatures they receive, and no other workspace', async () => {
    const { pool, candidatures, cci, club } = await setup()
    await pool.publish(cci.id, SOPHIE.id, consent('complet'))
    const received = await candidatures.getReceived(MARIE, CCI, cci.id)
    expect(received.poolPublication).toMatchObject({ state: 'listed', accessLevel: 'complet' })
    const [item] = await candidatures.listReceived(MARIE, CCI)
    expect(item.poolPublication).toMatchObject({ state: 'listed', accessLevel: 'complet' })
    // The club deal: its own candidature, never published in its pool.
    expect((await candidatures.getReceived(PAUL, CLUB, club.id)).poolPublication).toBeNull()
    await expect(candidatures.getReceived(PAUL, CLUB, cci.id)).rejects.toThrow(HttpException)
    // An investor of the CCI reads no candidature (unchanged before E07.03).
    expect(await failure(candidatures.getReceived(CLAIRE, CCI, cci.id))).toMatchObject({
      status: 403,
    })
  })
})
