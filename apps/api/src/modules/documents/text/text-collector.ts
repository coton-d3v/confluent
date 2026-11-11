// Text read from a document, in units the reader can cite: a page, a sheet, a slide (label null for
// a plain text file).
export interface TextUnit {
  label: string | null
  text: string
}

// A label comes from the file (a sheet name): it is shortened so it can never fill a part on its own
// (code review R50). Real sheet names are at most 31 characters.
const MAX_LABEL_CHARS = 120

function boundedLabel(label: string | null): string | null {
  return label && label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label
}

// Accumulates the text of a document up to a maximum length; past it, the rest is dropped and the
// text is marked truncated (readers stop as soon as `full` is set).
export class TextCollector {
  private readonly units: TextUnit[] = []
  private current: TextUnit | null = null
  private length = 0
  truncated = false

  constructor(private readonly maxChars: number) {}

  get full(): boolean {
    return this.truncated
  }

  startUnit(label: string | null): void {
    if (this.truncated) return
    this.current = { label: boundedLabel(label), text: '' }
    this.units.push(this.current)
  }

  add(text: string): void {
    if (this.truncated || !text) return
    if (!this.current) this.startUnit(null)
    const room = this.maxChars - this.length
    if (text.length > room) {
      text = text.slice(0, room)
      this.truncated = true
    }
    this.current!.text += text
    this.length += text.length
  }

  // Table cells are separated by tabs, rows by line breaks.
  endCell(): void {
    if (this.current?.text.endsWith('\n')) this.current.text = this.current.text.slice(0, -1)
    this.add('\t')
  }

  endRow(): void {
    if (this.current) this.current.text = this.current.text.replace(/\t+$/, '')
    this.add('\n')
  }

  finish(): TextUnit[] {
    return this.units.map((u) => ({ label: u.label, text: tidy(u.text) }))
  }
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// A slice of the text small enough to be returned at once, with the units it covers.
export interface TextPart {
  text: string
  from: string | null
  to: string | null
}

// Splits the units into parts of at most about `maxChars` characters, keeping a unit whole when it
// fits and cutting a longer one at line breaks; every part repeats the label of its unit.
export function paginate(units: TextUnit[], maxChars: number): TextPart[] {
  const parts: TextPart[] = []
  let current: TextPart | null = null
  const push = (block: string, label: string | null) => {
    if (current && current.text.length + block.length > maxChars) {
      parts.push(current)
      current = null
    }
    current ??= { text: '', from: label, to: label }
    current.text += block
    current.to = label
  }
  for (const unit of units) {
    const label = boundedLabel(unit.label)
    const header = (suffix = '') => (label ? `--- ${label}${suffix} ---\n` : '')
    if (header().length + unit.text.length + 2 <= maxChars) {
      push(`${header()}${unit.text}\n\n`, label)
      continue
    }
    chunks(unit.text, maxChars - header(' (suite)').length - 2).forEach((chunk, i) =>
      push(`${header(i ? ' (suite)' : '')}${chunk}\n\n`, label),
    )
  }
  if (current) parts.push(current)
  return parts.map((p) => ({ ...p, text: p.text.trimEnd() }))
}

// Every cut takes at least one character, whatever room the header leaves (code review R50).
function chunks(text: string, room: number): string[] {
  const size = Math.max(1, Math.floor(room))
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    const breakAt = rest.lastIndexOf('\n', size)
    const cut = breakAt > size / 2 ? breakAt + 1 : size
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut)
  }
  if (rest) out.push(rest)
  return out
}
