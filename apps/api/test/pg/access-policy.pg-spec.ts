import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { AuditService } from '../../src/modules/audit/audit.service'
import type { ClassificationService } from '../../src/modules/classification/classification.service'
import { CompaniesService } from '../../src/modules/companies/companies.service'
import { DossiersService } from '../../src/modules/dossiers/dossiers.service'
import { QuestionnairesService } from '../../src/modules/questionnaires/questionnaires.service'
import { testDatabase } from './database'

// ROADMAP E07.04 on PostgreSQL: the site's REST reading of a shared request and MCP
// (`resolveReadAccess`, the list of shared requests) reach the shares sent to the reader's address
// whatever its case — as the link itself and the opportunities do —, and a pattern character of an
// address never makes it match another one.
describe('reading a shared request (PostgreSQL)', () => {
  const prisma = testDatabase()
  const audit = new AuditService(prisma)
  const dossiers = new DossiersService(
    prisma,
    new QuestionnairesService(prisma),
    { evaluate: () => Promise.resolve(null) } as unknown as ClassificationService,
    audit,
    new CompaniesService(prisma),
  )
  const tag = randomUUID().slice(0, 8)
  let formId = ''

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${tag}@pg-test.dev`, mode: 'insensitive' } },
    })
    const ids = users.map((u) => u.id)
    await prisma.dossier.deleteMany({ where: { userId: { in: ids } } })
    await prisma.company.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: formId } })
    await prisma.questionnaire.deleteMany({ where: { id: formId } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  it('reaches the shares sent to the address whatever its case, never another address', async () => {
    const form = await prisma.questionnaire.create({
      data: { slug: `access-policy-${tag}`, name: 'Profil' },
    })
    formId = form.id
    const version = await prisma.questionnaireVersion.create({
      data: { questionnaireId: form.id, version: 1, status: 'published' },
    })
    const user = (name: string, role: 'entrepreneur' | 'financeur' = 'financeur') =>
      prisma.user.create({
        data: { email: `${name}-${tag}@pg-test.dev`, role, emailVerifiedAt: new Date() },
      })
    const owner = await user('owner', 'entrepreneur')
    const reader = await user('bob_x')
    const lookalike = await user('bobyx')
    const company = await prisma.company.create({
      data: { ownerId: owner.id, name: 'Biosensio', profileVersionId: version.id },
    })
    const request = (name: string) =>
      prisma.dossier.create({
        data: {
          userId: owner.id,
          companyId: company.id,
          name,
          slug: `${name}-${randomUUID().slice(0, 8)}`.toLowerCase(),
          questionnaireVersionId: version.id,
        },
      })
    const share = (dossierId: string, recipientEmail: string, accessLevel: string) =>
      prisma.shareLink.create({
        data: { dossierId, recipientEmail, token: randomUUID(), status: 'active', accessLevel },
      })
    const shared = await request('shared')
    // Stored before invitations were lowercased, and a second link at a narrower level.
    await share(shared.id, `BOB_X-${tag}@PG-TEST.DEV`, 'partiel')
    await share(shared.id, `bob_x-${tag}@pg-test.dev`, 'public')

    expect(await dossiers.resolveReadAccess(shared.id, reader)).toMatchObject({
      relation: 'share',
      accessLevel: 'partiel',
    })
    expect((await dossiers.listForUser(reader)).map((d) => d.id)).toEqual([shared.id])
    // `_` matches any character in a LIKE pattern: never here.
    await expect(dossiers.resolveReadAccess(shared.id, lookalike)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(await dossiers.listForUser(lookalike)).toEqual([])

    // Revoked: gone at the next reading.
    await prisma.shareLink.updateMany({
      where: { dossierId: shared.id },
      data: { status: 'revoked', revokedAt: new Date() },
    })
    await expect(dossiers.resolveReadAccess(shared.id, reader)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(await dossiers.listForUser(reader)).toEqual([])
  })
})
