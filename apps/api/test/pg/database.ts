import { PrismaClient } from '@prisma/client'
import { CommitteeNoticesService } from '../../src/modules/committees/committee-notices.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { quietNotifications } from '../../src/testing/notifications'

// Tests that need real PostgreSQL behaviour (transactions, locks, indexes), which the in-memory fake
// cannot show. They run against a disposable, migrated database:
//
//   TEST_DATABASE_URL=postgresql://…/disposable pnpm --filter @confluent/api test:pg
export function testDatabase(): PrismaService {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL must point to a disposable, migrated database.')
  if (url === process.env.DATABASE_URL)
    throw new Error('TEST_DATABASE_URL must not be DATABASE_URL.')
  return new PrismaClient({
    datasources: { db: { url: withPool(url) } },
  }) as unknown as PrismaService
}

// Prisma sizes its pool from the machine (2 × CPUs + 1 connections): the concurrency tests hold
// more connections at once (a lock, the requests waiting for it, the query watching them) than a
// 2-CPU CI runner allows. The same size everywhere, unless the URL sets one.
const TEST_POOL_SIZE = 20
function withPool(url: string): string {
  if (/[?&]connection_limit=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${TEST_POOL_SIZE}`
}

// E08.06: the notices of committees' changes, their emails going nowhere — for the tests of other
// committee rules (test/pg/committee-notices.pg-spec.ts reads what they send).
export function quietNotices(prisma: PrismaService): CommitteeNoticesService {
  return new CommitteeNoticesService(prisma, quietNotifications(prisma))
}

// Every dossier belongs to a company of the same owner (E05.04), whose profile answers the dossier's
// form version (E05.05): the company a test dossier is created in.
export async function companyOf(
  prisma: PrismaService,
  ownerId: string,
  profileVersionId: string,
): Promise<string> {
  const company = await prisma.company.create({
    data: { ownerId, name: 'Entreprise de test', profileVersionId },
  })
  return company.id
}

// A stored version of a new library document of the company (E05.06), as a deposit leaves it.
export async function documentOf(
  prisma: PrismaService,
  companyId: string,
  data: { filename: string; storageKey: string; mimetype?: string; size?: number },
) {
  const document = await prisma.libraryDocument.create({
    data: { companyId, filename: data.filename },
  })
  return prisma.document.create({
    data: {
      libraryDocumentId: document.id,
      companyId,
      filename: data.filename,
      mimetype: data.mimetype ?? 'application/pdf',
      storageKey: data.storageKey,
      size: data.size ?? 10,
    },
  })
}
