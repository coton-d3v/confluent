import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { AppConfig } from '../../src/config/config.schema'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { AuthService } from '../../src/modules/auth/auth.service'
import type { EmailTransport } from '../../src/modules/auth/email/email-transport'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { OpportunitiesService } from '../../src/modules/opportunities/opportunities.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { ShareLinksService } from '../../src/modules/share-links/share-links.service'
import { testDatabase } from './database'
import { opportunityViewsDown, opportunityViewsUp } from './sql-file'

const UP = opportunityViewsUp()
// Without the acceptance: what an operator runs first.
const DOWN = opportunityViewsDown().slice(1)
const ACCEPT_LOSS = "SET LOCAL confluent.accept_opportunity_views_loss = 'on'"
const REFUSE_LOSS = "SET LOCAL confluent.accept_opportunity_views_loss = 'off'"

class RolledBack extends Error {}

type Tx = Prisma.TransactionClient
const run = async (tx: Tx, statements: string[]) => {
  for (const sql of statements) await tx.$executeRawUnsafe(sql)
}
const rows = (tx: Tx, sql: string) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)

// ROADMAP E07.03 on PostgreSQL: the migration only adds the journal value of a reading, survives an
// interrupted deployment and can be undone (refusing, unless accepted, to lose readings). The
// opportunities are read by real queries — the share's address matched whatever its case, the
// pools through THE rule of the pool, the sector through the projection of each request's version —
// then filtered, sorted and paged.
describe('opportunities (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const questionnaires = new QuestionnairesService(prisma)
  const dossiers = new DossiersService(
    prisma,
    questionnaires,
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const shareLinks = new ShareLinksService(
    prisma,
    audit,
    { get: () => 'http://localhost:5173' } as unknown as ConfigService<AppConfig, true>,
    dossiers,
    { listForDossier: () => Promise.resolve([]) } as unknown as DocumentsService,
    {} as AuthService,
    questionnaires,
    { sendShareInvite: () => Promise.resolve() } as unknown as EmailTransport,
  )
  const opportunities = new OpportunitiesService(prisma, dossiers, shareLinks, audit)
  const tag = randomUUID().slice(0, 8)
  const workspaces: string[] = []
  let formId = ''
  let versionId = ''

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `opportunities-${tag}`, name: 'Profil' },
    })
    formId = form.id
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    versionId = version.id
    const section = await prisma.questionnaireSection.create({
      data: { versionId, key: 'identite', title: 'Identité', orderIndex: 0 },
    })
    // The sector is computed from a partial question: hidden at the public level.
    await prisma.questionnaireField.create({
      data: {
        versionId,
        sectionId: section.id,
        key: 'secteur_activite',
        label: 'Secteur',
        fieldType: 'text',
        orderIndex: 0,
        minAccessLevel: 'partiel',
      },
    })
  })

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev`, mode: 'insensitive' } },
    })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  const rolledBack = (fn: (tx: Tx) => Promise<void>) =>
    expect(
      prisma.$transaction(
        async (tx) => {
          await fn(tx)
          throw new RolledBack()
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow(RolledBack)

  const user = (name: string, role: 'entrepreneur' | 'financeur' = 'financeur') =>
    prisma.user.create({
      data: { email: `${name}-${tag}@pg-test.dev`, role, emailVerifiedAt: new Date() },
    })
  const workspace = async (name: string) => {
    const w = await prisma.workspace.create({
      data: { name, slug: `${name}-${tag}`.toLowerCase() },
    })
    workspaces.push(w.id)
    return w
  }
  const member = (workspaceId: string, userId: string, role: string, deactivated = false) =>
    prisma.workspaceMembership.create({
      data: { workspaceId, userId, role, deactivatedAt: deactivated ? new Date() : null },
    })

  // A request of `ownerId`, published (or not) with an amount and types, classified from the partial
  // question.
  async function request(
    ownerId: string,
    name: string,
    opts: { published?: boolean; amountEur?: number; types?: string[] } = {},
  ) {
    const company = await prisma.company.create({
      data: { ownerId, name, profileVersionId: versionId },
    })
    const published = opts.published ?? true
    return prisma.dossier.create({
      data: {
        userId: ownerId,
        companyId: company.id,
        name,
        slug: `${name}-${randomUUID().slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        questionnaireVersionId: versionId,
        sector: `Secteur ${name}`,
        classificationSources: { sector: ['secteur_activite'] },
        summary: `Résumé ${name}`,
        objective: 'Objectif',
        amountEur: opts.amountEur ?? 100_000,
        financingTypes: opts.types ?? ['equity'],
        publicationStatus: published ? 'published' : 'draft',
        publishedAt: published ? new Date() : null,
        submittedAt: new Date(),
      },
    })
  }
  // The request sent to the workspace and published in its pool at `level`.
  async function pooled(
    dossierId: string,
    workspaceId: string,
    level: string,
    opts: { financingStatus?: string; withdrawn?: boolean; consentedAt?: Date } = {},
  ) {
    const sentAt = new Date()
    const candidature = await prisma.candidature.create({
      data: {
        dossierId,
        workspaceId,
        formVersionId: versionId,
        createdAt: sentAt,
        submittedAt: sentAt,
        financingStatus: opts.financingStatus ?? 'preparing',
      },
    })
    const consentedAt = opts.consentedAt ?? new Date()
    return prisma.poolPublication.create({
      data: {
        candidatureId: candidature.id,
        workspaceId,
        accessLevel: level,
        consentedAt,
        ...(opts.withdrawn ? { withdrawnAt: consentedAt, withdrawalReason: 'owner' } : {}),
      },
    })
  }
  const shared = (dossierId: string, recipientEmail: string, level: string, status = 'active') =>
    prisma.shareLink.create({
      data: {
        dossierId,
        recipientEmail,
        token: randomUUID(),
        status: status as 'active',
        accessLevel: level,
      },
    })

  describe('migration', () => {
    it('adds the reading to the journal only; undone (refusing to lose readings unless accepted), then applied again', async () => {
      const reader = await user('migration')
      await rolledBack(async (tx) => {
        const counts = `SELECT (SELECT count(*)::int FROM audit_log) AS journal,
                  (SELECT count(*)::int FROM dossiers) AS dossiers,
                  (SELECT count(*)::int FROM share_links) AS links,
                  (SELECT count(*)::int FROM pool_publications) AS pools,
                  (SELECT count(*)::int FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                   WHERE t.typname = 'audit_action' AND e.enumlabel = 'opportunity_viewed') AS value`
        const [before] = await rows(tx, counts)
        expect(before.value).toBe(1)
        // Without any reading journaled: undone without acceptance, applied again (twice), the same.
        await run(tx, DOWN)
        await run(tx, UP)
        await run(tx, UP)
        expect((await rows(tx, counts))[0]).toEqual(before)

        await tx.$executeRawUnsafe(
          `INSERT INTO audit_log (id, action_type, actor_id, metadata)
           VALUES ('${randomUUID()}', 'opportunity_viewed', '${reader.id}', '{}'),
                  ('${randomUUID()}', 'share_link_viewed', '${reader.id}', '{}')`,
        )
        await tx.$executeRawUnsafe('SAVEPOINT before_down')
        await expect(run(tx, DOWN)).rejects.toThrow(/would be lost/)
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_down')
        await run(tx, [ACCEPT_LOSS, ...DOWN, REFUSE_LOSS])
        // Only the readings go; the value stays (PostgreSQL cannot remove it), unused.
        expect((await rows(tx, counts))[0]).toEqual({
          ...before,
          journal: (before.journal as number) + 1,
        })
        expect(
          await rows(
            tx,
            `SELECT action_type::text AS a FROM audit_log WHERE actor_id = '${reader.id}'`,
          ),
        ).toEqual([{ a: 'share_link_viewed' }])
        await run(tx, UP)
        expect((await rows(tx, counts))[0].value).toBe(1)
      })
    })
  })

  describe('reading', () => {
    it('reaches direct shares whatever the case of the address, and the listed publications of the pools read', async () => {
      const owner = await user('owner', 'entrepreneur')
      const reader = await user('Reader')
      const cci = await workspace('CCI')
      const club = await workspace('Club')
      const other = await workspace('Other')
      await member(cci.id, reader.id, 'investisseur')
      await member(club.id, reader.id, 'investisseur', true)
      await member(other.id, reader.id, 'conseiller')

      const both = await request(owner.id, 'Both', { amountEur: 500_000 })
      await shared(both.id, `READER-${tag}@PG-TEST.DEV`, 'public')
      await pooled(both.id, cci.id, 'complet')
      const sharedOnly = await request(owner.id, 'Draft', { published: false })
      await shared(sharedOnly.id, `reader-${tag}@pg-test.dev`, 'partiel')
      // Nothing of these: revoked, someone else's share, a withdrawn or paused publication, the pool
      // of a deactivated membership, of a workspace read as a conseiller.
      const revoked = await request(owner.id, 'Revoked')
      await shared(revoked.id, `reader-${tag}@pg-test.dev`, 'complet', 'revoked')
      const elsewhere = await request(owner.id, 'Elsewhere')
      await shared(elsewhere.id, `someone-${tag}@pg-test.dev`, 'complet')
      const withdrawn = await request(owner.id, 'Withdrawn')
      await pooled(withdrawn.id, cci.id, 'complet', { withdrawn: true })
      const closed = await request(owner.id, 'Closed')
      await pooled(closed.id, cci.id, 'complet', { financingStatus: 'funded' })
      const unpublished = await request(owner.id, 'Unpublished', { published: false })
      await pooled(unpublished.id, cci.id, 'complet')
      const inClub = await request(owner.id, 'InClub')
      await pooled(inClub.id, club.id, 'complet')
      const inOther = await request(owner.id, 'InOther')
      await pooled(inOther.id, other.id, 'complet')
      // The reader's own request, in the pool they read.
      const own = await request(reader.id, 'Own')
      await pooled(own.id, cci.id, 'complet')

      const page = await opportunities.list(reader)
      expect(page.counts).toMatchObject({
        total: 2,
        shares: 2,
        pools: [{ workspace: { id: cci.id }, count: 1 }],
        sectors: [
          { value: 'Secteur Both', count: 1 },
          { value: 'Secteur Draft', count: 1 },
        ],
      })
      const byName = new Map(page.items.map((i) => [i.dossier.name, i]))
      expect([...byName.keys()].sort()).toEqual(['Both', 'Draft'])
      expect(byName.get('Both')).toMatchObject({
        accessLevel: 'complet',
        sources: [
          { kind: 'share', accessLevel: 'public' },
          { kind: 'pool', accessLevel: 'complet', workspace: { id: cci.id, name: 'CCI' } },
        ],
        dossier: { sector: 'Secteur Both', amountEur: 500_000 },
      })
      // A partial share of a draft: the sector its level may read, no presentation.
      expect(byName.get('Draft')).toMatchObject({
        accessLevel: 'partiel',
        dossier: { sector: 'Secteur Draft', summary: null, amountEur: null },
      })

      for (const unreachable of [
        revoked,
        elsewhere,
        withdrawn,
        closed,
        unpublished,
        inClub,
        inOther,
        own,
      ]) {
        await expect(opportunities.get(reader, unreachable.id)).rejects.toBeInstanceOf(
          HttpException,
        )
      }
      const read = await opportunities.get(reader, both.id)
      expect(read.opportunity.accessLevel).toBe('complet')
      expect(read.fields.map((f) => f.key)).toEqual(['secteur_activite'])
      const [entry] = await prisma.auditLog.findMany({
        where: { actorId: reader.id, actionType: 'opportunity_viewed' },
      })
      expect(entry).toMatchObject({
        dossierId: both.id,
        metadata: { accessLevel: 'complet', workspaceIds: [cci.id] },
      })
      expect(entry.shareLinkId).not.toBeNull()
    })

    it('filters on the projection, sorts and pages', async () => {
      const owner = await user('owner2', 'entrepreneur')
      const reader = await user('reader2')
      const cci = await workspace('Pool')
      await member(cci.id, reader.id, 'investisseur')
      const base = Date.now() - 100_000
      for (let i = 0; i < 25; i++) {
        const d = await request(owner.id, `Projet ${String(i).padStart(2, '0')}`, {
          amountEur: (i + 1) * 10_000,
          types: i % 2 === 0 ? ['equity'] : ['grant'],
        })
        // Public: the sector, computed from a partial question, is hidden from all of them.
        await pooled(d.id, cci.id, i < 5 ? 'partiel' : 'public', {
          consentedAt: new Date(base + i * 1000),
        })
      }
      const first = await opportunities.list(reader)
      expect(first).toMatchObject({ total: 25, page: 1, pageSize: 20 })
      expect(first.items.map((i) => i.dossier.name).slice(0, 2)).toEqual(['Projet 24', 'Projet 23'])
      const second = await opportunities.list(reader, { page: 2 })
      expect(second.items.map((i) => i.dossier.name)).toEqual([
        'Projet 04',
        'Projet 03',
        'Projet 02',
        'Projet 01',
        'Projet 00',
      ])
      expect(first.counts.sectors.map((s) => s.value)).toEqual([
        'Secteur Projet 00',
        'Secteur Projet 01',
        'Secteur Projet 02',
        'Secteur Projet 03',
        'Secteur Projet 04',
      ])
      expect((await opportunities.list(reader, { sector: 'secteur projet 03' })).total).toBe(1)
      expect((await opportunities.list(reader, { sector: 'Secteur Projet 10' })).total).toBe(0)
      const bounded = await opportunities.list(reader, {
        amountMin: 50_000,
        amountMax: 100_000,
        financingType: 'grant',
        sort: 'amount_desc',
      })
      expect(bounded.items.map((i) => i.dossier.amountEur)).toEqual([100_000, 80_000, 60_000])
      expect((await opportunities.list(reader, { q: 'PROJET 1' })).total).toBe(10)
      expect(
        (await opportunities.list(reader, { sort: 'name', page: 2 })).items[0].dossier.name,
      ).toBe('Projet 20')
    })
  })
})
