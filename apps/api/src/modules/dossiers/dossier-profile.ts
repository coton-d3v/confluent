import { NotFoundException } from '@nestjs/common'
import type { Dossier, Prisma } from '@prisma/client'

// A dossier presents its company's profile (E05.05): the answers and documents are the company's,
// read and written through any of its dossiers. `userId`: its owner when the caller read it.
export type DossierRef = Pick<Dossier, 'id' | 'companyId'> & { userId?: string }

const notFound = () =>
  new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier introuvable.' })

// Every write that depends on the state of a profile (saving answers, depositing a document,
// submitting or reclassifying a dossier) holds the company's row for the rest of the transaction and
// reads the state only afterwards (code review R40): a save working from a dossier read before its
// submission, or a submission racing a save, sees the other one's result instead of an outdated
// snapshot. The lock is the company's, since its dossiers share the profile. Returns the dossier as
// it is once the lock is held.
//
// Given the dossier as the caller read it (with its owner), the write goes on only if the company
// still has that owner once locked: the transfer of a company (E05.08) takes the same lock, so a
// write its former holder started earlier — an upload sending its file, a save waiting for the
// lock — is refused with the 404 of a dossier they no longer reach, never applied to the new
// owner's company.
export async function lockProfile(
  tx: Prisma.TransactionClient,
  ref: string | Pick<DossierRef, 'id' | 'userId'>,
): Promise<Dossier> {
  const dossierId = typeof ref === 'string' ? ref : ref.id
  const expectedOwner = typeof ref === 'string' ? undefined : ref.userId
  const found = await tx.dossier.findUnique({ where: { id: dossierId } })
  if (!found) throw notFound()
  await tx.$queryRaw`SELECT 1 FROM "companies" WHERE "id" = ${found.companyId} FOR UPDATE`
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId } })
  if (!dossier) throw notFound()
  if (expectedOwner !== undefined && dossier.userId !== expectedOwner) throw notFound()
  return dossier
}
