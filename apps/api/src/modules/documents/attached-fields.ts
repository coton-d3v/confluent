import type { PrismaClient } from '@prisma/client'

// Attachment fields of a dossier that have at least one document: they count as answered (E03.11).
// Takes the caller's client or transaction, e.g. the submission reads it under the dossier's lock.
export async function attachedFieldIds(
  db: Pick<PrismaClient, 'document'>,
  dossierId: string,
): Promise<Set<string>> {
  const rows = await db.document.findMany({
    where: { dossierId, fieldId: { not: null } },
    select: { fieldId: true },
  })
  return new Set(rows.flatMap((r) => (r.fieldId ? [r.fieldId] : [])))
}
