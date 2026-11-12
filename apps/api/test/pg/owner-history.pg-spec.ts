import { randomUUID } from 'node:crypto'
import { OWNER_HISTORY_PAGE_SIZE, type OwnerHistoryFilter } from '@confluent/shared'
import { AuditService } from '../../src/modules/audit/audit.service'
import { ReadingSessionsService } from '../../src/modules/reading-sessions/reading-sessions.service'
import { OwnerHistoryService } from '../../src/modules/owner-history/owner-history.service'
import type { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { companyOf, testDatabase } from './database'

const MINUTE = 60_000

// ROADMAP E07.09 on PostgreSQL: the owner's history merges the journal and the reading sessions, each
// read the latest first with a bound, one page at a time. Walking the pages gives every shown entry
// exactly once, in one order — even when many rows of both sources share the same instant across a
// page's boundary —, and nothing of hidden actions, of readings through pools alone or of another
// request. The access rule is the e2e tests' (test/owner-history.e2e-spec.ts).
describe('owner history (PostgreSQL)', () => {
  const prisma = testDatabase()
  const readings = new ReadingSessionsService(prisma, new AuditService(prisma))
  // Access is checked by `DossiersService.getByIdForUser` before anything is read.
  const dossiers = { getByIdForUser: async () => ({}) } as unknown as DossiersService
  const history = new OwnerHistoryService(prisma, dossiers, readings)
  const tag = randomUUID().slice(0, 8)
  let formId = ''
  let versionId = ''
  const dossierIds: string[] = []

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `history-${tag}`, name: 'Profil' },
    })
    formId = form.id
    versionId = (
      await prisma.questionnaireVersion.create({
        data: { questionnaireId: form.id, version: 1, status: 'published' },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { dossierId: { in: dossierIds } } })
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev` } },
    })
    const ids = users.map((u) => u.id)
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  const user = (name: string) =>
    prisma.user.create({
      data: {
        email: `${name}-${randomUUID().slice(0, 6)}-${tag}@pg-test.dev`,
        role: 'entrepreneur',
        emailVerifiedAt: new Date(),
      },
    })

  async function request(ownerId: string) {
    const dossier = await prisma.dossier.create({
      data: {
        userId: ownerId,
        companyId: await companyOf(prisma, ownerId, versionId),
        name: 'Biosensio',
        slug: `history-${randomUUID().slice(0, 8)}`,
        questionnaireVersionId: versionId,
      },
    })
    dossierIds.push(dossier.id)
    return dossier
  }

  // 25 administration's edits and 25 consultations, seven of each per minute: every minute holds
  // fourteen rows of the same instant, across the boundaries of the pages (20, 40). Around them,
  // what the history never shows.
  async function busyRequest() {
    const owner = await user('owner')
    const reader = await user('reader')
    const investor = await user('investor')
    const dossier = await request(owner.id)
    const other = await request(owner.id)
    const link = await prisma.shareLink.create({
      data: {
        dossierId: dossier.id,
        recipientEmail: reader.email,
        token: randomUUID(),
        status: 'active',
      },
    })
    const base = Date.now() - 24 * 60 * MINUTE
    const at = (i: number) => new Date(base - Math.floor(i / 7) * MINUTE)
    for (let i = 0; i < 25; i++) {
      await prisma.auditLog.create({
        data: {
          dossierId: dossier.id,
          actorId: owner.id,
          actionType: 'admin_edited_field',
          metadata: { fieldId: randomUUID(), oldValue: '', newValue: `v-${i}` },
          createdAt: at(i),
        },
      })
      await prisma.readingSession.create({
        data: {
          dossierId: dossier.id,
          readerId: reader.id,
          shareLinkId: link.id,
          channel: 'share',
          startedAt: at(i),
          lastSeenAt: at(i),
          activeMs: i * 1000,
        },
      })
      // Hidden: an investor's reading through the pool alone, its entry, their pledge; another
      // request's entry.
      await prisma.readingSession.create({
        data: {
          dossierId: dossier.id,
          readerId: investor.id,
          shareLinkId: null,
          channel: 'opportunity',
          startedAt: at(i),
          lastSeenAt: at(i),
          activeMs: null,
        },
      })
      for (const actionType of ['opportunity_viewed', 'investor_pledge_set'] as const) {
        await prisma.auditLog.create({
          data: { dossierId: dossier.id, actorId: investor.id, actionType, createdAt: at(i) },
        })
      }
      await prisma.auditLog.create({
        data: {
          dossierId: other.id,
          actorId: owner.id,
          actionType: 'admin_edited_field',
          metadata: { newValue: `other-${i}` },
          createdAt: at(i),
        },
      })
    }
    return { owner, dossier }
  }

  // Every page of a filter, walked to the first empty one.
  async function walk(dossierId: string, filter: OwnerHistoryFilter) {
    const items: Array<{ key: string; at: number }> = []
    const totals = new Set<number>()
    for (let page = 1; page < 10; page++) {
      const view = await history.forOwner(dossierId, 'owner', { filter, page })
      totals.add(view.total)
      if (view.items.length === 0) break
      expect(view.items.length).toBeLessThanOrEqual(OWNER_HISTORY_PAGE_SIZE)
      for (const item of view.items) {
        const key =
          item.kind === 'consultation'
            ? `s:${item.consultation?.activeSeconds}`
            : `j:${item.details.find((d) => d.label === 'Après')?.value}`
        items.push({ key, at: item.occurredAt.getTime() })
      }
    }
    return { items, totals: [...totals] }
  }

  it('walks every page once, the latest first, the journal before the sessions at the same instant', async () => {
    const { dossier } = await busyRequest()
    const { items, totals } = await walk(dossier.id, 'all')
    expect(totals).toEqual([50])
    expect(items).toHaveLength(50)
    expect(new Set(items.map((i) => i.key)).size).toBe(50)
    // The order: latest first; at one instant, the journal's entries, then the sessions.
    const minutes = [0, 1, 2, 3].map((m) => {
      const n = Math.min(7, 25 - m * 7)
      return { journal: n, sessions: n }
    })
    const expectedShape = minutes.flatMap((m) => [
      ...Array<string>(m.journal).fill('j'),
      ...Array<string>(m.sessions).fill('s'),
    ])
    expect(items.map((i) => i.key[0])).toEqual(expectedShape)
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort((a, b) => b - a))
    expect(items.some((i) => i.key.startsWith('j:other'))).toBe(false)

    // The ids decide among rows of one instant, the same way on every page: each filter walks its
    // own entries in the same relative order as `all`.
    const consultations = await walk(dossier.id, 'consultations')
    expect(consultations.totals).toEqual([25])
    expect(consultations.items.map((i) => i.key)).toEqual(
      items.filter((i) => i.key.startsWith('s:')).map((i) => i.key),
    )
    const administration = await walk(dossier.id, 'administration')
    expect(administration.totals).toEqual([25])
    expect(administration.items.map((i) => i.key)).toEqual(
      items.filter((i) => i.key.startsWith('j:')).map((i) => i.key),
    )
    const access = await walk(dossier.id, 'access')
    expect([access.totals, access.items]).toEqual([[0], []])
  })

  it('reads the same pages again while nothing changes', async () => {
    const { dossier } = await busyRequest()
    const first = await walk(dossier.id, 'all')
    const again = await walk(dossier.id, 'all')
    expect(again).toEqual(first)
  })
})
