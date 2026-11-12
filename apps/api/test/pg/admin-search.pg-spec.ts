import { randomUUID } from 'node:crypto'
import { AdminDossiersService } from '../../src/modules/admin/admin-dossiers.service'
import type { AnswersService } from '../../src/modules/answers/answers.service'
import type { AuditService } from '../../src/modules/audit/audit.service'
import type { DocumentsService } from '../../src/modules/documents/documents.service'
import type { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { testDatabase } from './database'

// ROADMAP E10.05 on PostgreSQL: the administrators' search of the requests is SQL — case ignored as
// PostgreSQL ignores it, the wildcards of LIKE taken literally in a searched text, whole values for a
// slug, an identifier or an email address — and its pages, ordered by creation then identifier, give
// every request exactly once even when many were created at the same instant. Rights and the HTTP
// contract: test/admin.e2e-spec.ts.
describe('administrators’ search of the requests (PostgreSQL)', () => {
  const prisma = testDatabase()
  const service = new AdminDossiersService(
    prisma,
    null as unknown as AnswersService,
    null as unknown as AuditService,
    null as unknown as QuestionnairesService,
    null as unknown as DocumentsService,
  )
  const tag = randomUUID().slice(0, 8)
  // A marker no other test's data contains: each search below is narrowed to this test's rows.
  const marker = `qx${tag}`
  let formId = ''
  let ownerId = ''
  let companyId = ''
  const ids: string[] = []
  const SAME_INSTANT = new Date('2026-03-01T10:00:00Z')

  beforeAll(async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `admin-search-${tag}`, name: 'Profil' },
    })
    formId = form.id
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    ownerId = (
      await prisma.user.create({
        data: {
          email: `Owner-${tag}@PG-Test.dev`,
          role: 'entrepreneur',
          emailVerifiedAt: new Date(),
        },
      })
    ).id
    companyId = (
      await prisma.company.create({
        data: { ownerId, name: `Société ${marker} 100%_net`, profileVersionId: version.id },
      })
    ).id
    // 45 requests at the same instant, across pages of 20.
    for (let n = 0; n < 45; n++) {
      const d = await prisma.dossier.create({
        data: {
          userId: ownerId,
          companyId,
          questionnaireVersionId: version.id,
          name: n === 0 ? `Levée ${marker} À 50%` : `Tour ${marker} ${n}`,
          slug: `${marker}-tour-${n}`,
          createdAt: SAME_INSTANT,
        },
      })
      ids.push(d.id)
    }
  })

  afterAll(async () => {
    await prisma.dossier.deleteMany({ where: { userId: ownerId } })
    await prisma.company.deleteMany({ where: { ownerId } })
    await prisma.user.deleteMany({ where: { id: ownerId } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.$disconnect()
  })

  const search = (q: string, page = 1, pageSize = 100) => service.list({ q, page, pageSize })
  const idsOf = async (q: string) => (await search(q)).items.map((d) => d.id).sort()

  it('walks every request created at the same instant once, page after page, by identifier', async () => {
    const seen: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await search(marker, page, 20)
      expect(result.total).toBe(45)
      seen.push(...result.items.map((d) => d.id))
    }
    expect(seen).toHaveLength(45)
    expect(new Set(seen).size).toBe(45)
    expect(seen).toEqual([...ids].sort().reverse())
  })

  it('ignores case in titles and company names, and takes LIKE’s wildcards literally', async () => {
    expect(await idsOf(`${marker} À 50\\`)).toEqual([])
    expect(await idsOf(`LEVÉE ${marker.toUpperCase()}`)).toEqual([ids[0]])
    expect(await idsOf(`${marker} à 50%`)).toEqual([ids[0]])
    // `%` and `_` are characters, not patterns: « 5_% » is in no title nor company name.
    expect(await idsOf(`${marker} À 5_%`)).toEqual([])
    expect(await idsOf(`${marker} à %`)).toEqual([])
    // The company's name finds all its requests.
    expect((await search(`${marker} 100%_NET`)).total).toBe(45)
    expect((await search(`${marker} 100%xnet`)).total).toBe(0)
  })

  it('matches a slug, an identifier and an email address only as a whole, case ignored', async () => {
    const bySlug = await search(`${marker.toUpperCase()}-TOUR-7`)
    expect(bySlug.items.map((d) => d.id)).toEqual([ids[7]])
    expect(bySlug.exactMatch?.id).toBe(ids[7])
    expect((await search(`${marker}-tour-`)).total).toBe(0)
    const byId = await search(ids[3].toUpperCase())
    expect(byId.items.map((d) => d.id)).toEqual([ids[3]])
    expect(byId.exactMatch?.id).toBe(ids[3])
    expect((await search(ids[3].slice(0, 23))).total).toBe(0)
    expect((await search(companyId)).total).toBe(45)
    expect((await search(`owner-${tag}@pg-test.dev`)).total).toBe(45)
    expect((await search(`owner-${tag}@pg-test`)).total).toBe(0)
    expect((await search(`${tag}@pg-test.dev`)).total).toBe(0)
    expect((await service.lookup(`${marker}-TOUR-12`)).id).toBe(ids[12])
    await expect(service.lookup(`${marker}-tour-1`)).resolves.toMatchObject({ id: ids[1] })
    await expect(service.lookup(`${marker}-tour`)).rejects.toMatchObject({ status: 404 })
  })
})
