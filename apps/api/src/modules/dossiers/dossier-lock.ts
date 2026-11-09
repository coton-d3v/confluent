import { NotFoundException } from '@nestjs/common'
import type { Dossier, Prisma } from '@prisma/client'

// Every write that depends on the state of a dossier (saving answers, submitting) holds its row
// for the rest of the transaction and reads the state only afterwards (code review R40): a save
// working from a dossier read before its submission, or a submission racing a save, sees the other
// one's result instead of an outdated snapshot.
export async function lockDossier(
  tx: Prisma.TransactionClient,
  dossierId: string,
): Promise<Dossier> {
  await tx.$queryRaw`SELECT 1 FROM "dossiers" WHERE "id" = ${dossierId} FOR UPDATE`
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId } })
  if (!dossier) {
    throw new NotFoundException({ code: 'DOSSIER_NOT_FOUND', message: 'Dossier introuvable.' })
  }
  return dossier
}
