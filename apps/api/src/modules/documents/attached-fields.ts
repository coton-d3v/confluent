import type { PrismaClient } from '@prisma/client'

// Attachment fields of a company's profile that have at least one document: they count as answered
// (E03.11). A library document always has a version (both are created together, E05.06). Takes the
// caller's client or transaction, e.g. the submission reads it under the profile's lock.
export async function attachedFieldIds(
  db: Pick<PrismaClient, 'libraryDocument'>,
  companyId: string,
): Promise<Set<string>> {
  const rows = await db.libraryDocument.findMany({
    where: { companyId, fieldId: { not: null } },
    select: { fieldId: true },
  })
  return new Set(rows.flatMap((r) => (r.fieldId ? [r.fieldId] : [])))
}
