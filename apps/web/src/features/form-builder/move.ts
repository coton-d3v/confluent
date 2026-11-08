// Ids in their new order after moving `id` one step up (-1) or down (+1); null when it cannot move.
export function moveId(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(id)
  const to = from + step
  if (from < 0 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
