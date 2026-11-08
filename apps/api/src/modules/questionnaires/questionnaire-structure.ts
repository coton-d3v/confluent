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

// A choice of a `select` field (E03.06). Answers store `key`; `label` is only displayed.
export interface Choice {
  key: string
  label: string
}

// A choice to create: without `key`, it is derived from the label.
export interface ChoiceInput {
  key?: string
  label: string
}

// Explicit keys are kept as given; missing ones are derived with `toKey`, suffixed when they would
// collide with another choice of the field.
export function toChoices(inputs: readonly ChoiceInput[]): Choice[] {
  const taken = new Set(inputs.flatMap((c) => (c.key ? [c.key] : [])))
  return inputs.map(({ key, label }) => ({ key: key ?? uniqueKey(toKey(label), taken), label }))
}

// Choices from plain labels (seeds).
export const labelsToChoices = (labels: readonly string[]): ChoiceInput[] =>
  labels.map((label) => ({ label }))

// Reads the `choices` JSON column defensively (unknown shapes yield no choice).
export function readChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (c): c is Choice =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as Choice).key === 'string' &&
      typeof (c as Choice).label === 'string',
  )
}

export interface StructureFieldInput {
  section: string
  key?: string
  label: string
  helpText?: string | null
  fieldType: field_type
  choices?: readonly ChoiceInput[]
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
    data: fields.map(({ section, key, choices, ...f }) => ({
      ...f,
      choices: toChoices(choices ?? []) as unknown as Prisma.InputJsonValue,
      versionId,
      sectionId: sectionIds.get(section)!,
      key: key ?? uniqueKey(toKey(f.label), fieldKeys),
    })),
  })
}

// Copies the sections and fields of a version into another one, keys and choices included, so that
// a draft started from the published version reads answers exactly the same way (E03.06, E03.08).
export async function copyVersionStructure(
  tx: Prisma.TransactionClient,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  const [sections, fields] = await Promise.all([
    tx.questionnaireSection.findMany({ where: { versionId: fromVersionId } }),
    tx.questionnaireField.findMany({ where: { versionId: fromVersionId } }),
  ])
  const sectionIds = new Map<string, string>()
  for (const { id, key, title, orderIndex } of sections) {
    const copy = await tx.questionnaireSection.create({
      data: { versionId: toVersionId, key, title, orderIndex },
    })
    sectionIds.set(id, copy.id)
  }
  // Every column of a field definition: a new column must be added here to survive drafts.
  await tx.questionnaireField.createMany({
    data: fields.map((f) => ({
      versionId: toVersionId,
      sectionId: sectionIds.get(f.sectionId)!,
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      fieldType: f.fieldType,
      choices: f.choices as Prisma.InputJsonValue,
      required: f.required,
      orderIndex: f.orderIndex,
      constraints: f.constraints as Prisma.InputJsonValue,
      minAccessLevel: f.minAccessLevel,
    })),
  })
}

// `base`, or `base_2`, `base_3`… when already taken; the returned key is added to `taken`.
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 56)}_${n}`
  taken.add(key)
  return key
}
