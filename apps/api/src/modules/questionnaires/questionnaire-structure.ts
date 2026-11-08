import type { Prisma, field_type } from '@prisma/client'

// Shared by the API, the seeds and scripts/seed-questionnaire-v2.ts (copied into the production
// image): keep it free of Nest dependencies.

const ACCENTS: Record<string, string> = Object.fromEntries(
  [...'ÀÂÄÁÃÉÈÊËÎÏÍÔÖÓÕÙÛÜÚÇàâäáãéèêëîïíôöóõùûüúç'].map((c, i) => [
    c,
    'AAAAAEEEEIIIOOOOUUUUCaaaaaeeeeiiioooouuuuc'[i],
  ]),
)

// Technical key from a human label (E03.06). Mirrors `pg_temp.confluent_key` in migration
// 20261109010000_forms_sections_version_status: lowercase, accents stripped, non-alphanumerics → "_",
// starts with a letter, ≤ 60 characters.
export function toKey(label: string): string {
  const slug = [...label]
    .map((c) => ACCENTS[c] ?? c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  if (!slug) return 'champ'
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`
}

export interface StructureFieldInput {
  section: string
  key?: string
  label: string
  helpText?: string | null
  fieldType: field_type
  options?: string[]
  required: boolean
  orderIndex: number
  constraints?: Prisma.InputJsonValue
  minAccessLevel?: string
}

// Creates the sections (in order of first appearance) and fields of a version. Field keys default to
// `toKey(label)`, suffixed when they would collide within the version.
export async function createVersionStructure(
  tx: Prisma.TransactionClient,
  versionId: string,
  fields: readonly StructureFieldInput[],
): Promise<void> {
  const sectionIds = new Map<string, string>()
  const sectionKeys = new Set<string>()
  for (const title of new Set(fields.map((f) => f.section))) {
    const key = uniqueKey(toKey(title), sectionKeys)
    const section = await tx.questionnaireSection.create({
      data: { versionId, key, title, orderIndex: sectionIds.size },
    })
    sectionIds.set(title, section.id)
  }
  const fieldKeys = new Set(fields.flatMap((f) => (f.key ? [f.key] : [])))
  await tx.questionnaireField.createMany({
    data: fields.map(({ section, key, ...f }) => ({
      ...f,
      versionId,
      sectionId: sectionIds.get(section)!,
      key: key ?? uniqueKey(toKey(f.label), fieldKeys),
    })),
  })
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 56)}_${n}`
  taken.add(key)
  return key
}
