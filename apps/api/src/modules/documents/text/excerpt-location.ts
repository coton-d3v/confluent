import type { TextUnit } from './text-collector'

// Where an excerpt cited as the source of an answer appears in a document's text (E04.04): the
// label of its unit (page, sheet, slide), `null` for a text without units, or not found. Spacing,
// letter case, typographic quotes and ligatures are ignored, so that a passage copied from
// read_document is found; anything else must match.
export type ExcerptLocation = { found: true; location: string | null } | { found: false }

export function locateExcerpt(units: TextUnit[], excerpt: string): ExcerptLocation {
  const needle = normalize(excerpt)
  if (!needle) return { found: false }
  // Units joined by a space, so that an excerpt running over two pages is still found.
  let haystack = ''
  const starts: number[] = []
  for (const unit of units) {
    if (haystack) haystack += ' '
    starts.push(haystack.length)
    haystack += normalize(unit.text)
  }
  const at = haystack.indexOf(needle)
  if (at < 0) return { found: false }
  const unitAt = (offset: number) => starts.findLastIndex((start) => start <= offset)
  const first = units[unitAt(at)].label
  const last = units[unitAt(at + needle.length - 1)].label
  return { found: true, location: first && last && first !== last ? `${first} à ${last}` : first }
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/[‘’‛ʼ′]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fr')
}
