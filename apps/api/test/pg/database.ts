import { PrismaClient } from '@prisma/client'
import type { PrismaService } from '../../src/prisma/prisma.service'

// Tests that need real PostgreSQL behaviour (transactions, locks, indexes), which the in-memory fake
// cannot show. They run against a disposable, migrated database:
//
//   TEST_DATABASE_URL=postgresql://…/disposable pnpm --filter @confluent/api test:pg
export function testDatabase(): PrismaService {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL must point to a disposable, migrated database.')
  if (url === process.env.DATABASE_URL)
    throw new Error('TEST_DATABASE_URL must not be DATABASE_URL.')
  return new PrismaClient({ datasources: { db: { url } } }) as unknown as PrismaService
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
