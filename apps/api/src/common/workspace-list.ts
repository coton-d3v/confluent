import { slugify } from './slug'

// The rules shared by the lists a workspace's managers configure — its funding source categories
// (ROADMAP E06.02) and its eligibility schemes (E06.05): a stable `snake_case` key derived once from
// the first label, a label told apart from the others without regard to case, a new item last, and a
// reorder that names exactly the whole list.

// `snake_case` ASCII from the label (`fallback` when nothing is left), at most `maxLength`
// characters, suffixed `_2`, `_3`… when already taken in the list.
export function listKey(
  label: string,
  items: ReadonlyArray<{ key: string }>,
  { maxLength, fallback }: { maxLength: number; fallback: string },
): string {
  const room = maxLength - 4
  const base =
    slugify(label, fallback).replace(/-/g, '_').slice(0, room).replace(/_+$/, '') || fallback
  const taken = new Set(items.map((i) => i.key))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

// The item already called `label` (« Prêt bancaire » and « prêt bancaire » read as the same), other
// than `exceptId`, if any.
export function labelClash<T extends { id: string; label: string }>(
  items: ReadonlyArray<T>,
  label: string,
  exceptId: string | null,
): T | undefined {
  const wanted = label.toLocaleLowerCase('fr')
  return items.find((i) => i.id !== exceptId && i.label.toLocaleLowerCase('fr') === wanted)
}

export function nextPosition(items: ReadonlyArray<{ position: number }>): number {
  return items.reduce((max, i) => Math.max(max, i.position + 1), 0)
}

// A new order is accepted only when it names every item of the list once: otherwise the client
// works from a stale list.
export function namesWholeList(items: ReadonlyArray<{ id: string }>, ids: string[]): boolean {
  const known = new Set(items.map((i) => i.id))
  return (
    ids.length === items.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => known.has(id))
  )
}
