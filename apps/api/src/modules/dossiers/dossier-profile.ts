import { NotFoundException } from '@nestjs/common'
import type { Dossier, Prisma } from '@prisma/client'

// A dossier presents its company's profile (E05.05): the answers and documents are the company's,
// read and written through any of its dossiers.
export type DossierRef = Pick<Dossier, 'id' | 'companyId'>

const notFound = () =>
  new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier introuvable.' })

// Every write that depends on the state of a profile (saving answers, depositing a document,
// submitting or reclassifying a dossier) holds the company's row for the rest of the transaction and
// reads the state only afterwards (code review R40): a save working from a dossier read before its
// submission, or a submission racing a save, sees the other one's result instead of an outdated
// snapshot. The lock is the company's, since its dossiers share the profile. Returns the dossier as
// it is once the lock is held.
export async function lockProfile(
  tx: Prisma.TransactionClient,
  dossierId: string,
): Promise<Dossier> {
  const found = await tx.dossier.findUnique({ where: { id: dossierId } })
  if (!found) throw notFound()
  await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "id" = ${found.companyId} FOR UPDATE`
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId } })
  if (!dossier) throw notFound()
  return dossier
}
