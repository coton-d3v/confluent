import { posix } from 'node:path'
import type { TextCollector } from './text-collector'
import { listZipEntries, readZipEntry, ZipFormatError, type ZipEntry } from './zip-entries'

// Text of Office Open XML (docx, xlsx, pptx) and OpenDocument (odt, ods, odp) files: only the parts
// holding the visible content are read (no comments, tracked deletions, speaker notes or embedded
// objects).
export type OfficeKind = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp'

// One XML part is at most this large once inflated, and a whole document at most the total.
const MAX_PART_BYTES = 40 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
// Columns read per spreadsheet row: wider rows are cut (keeps the text readable and bounded).
const MAX_COLUMNS = 100

export function extractOfficeText(
  buffer: Buffer,
  kind: OfficeKind,
  out: TextCollector,
  timeLimitMs: number,
): void {
  // Read on the main thread: bounded in time as well as in bytes (code review R51).
  const deadline = Date.now() + timeLimitMs
  const entries = listZipEntries(buffer)
  let budget = MAX_TOTAL_BYTES
  const read = (entry: ZipEntry): string => {
    if (budget <= 0) {
      out.truncated = true
      return ''
    }
    const xml = readZipEntry(buffer, entry, Math.min(MAX_PART_BYTES, budget))
    budget -= xml.length
    return xml.toString('utf8')
  }
  const required = (name: string): ZipEntry => {
    const entry = entries.get(name)
    if (!entry) throw new ZipFormatError(`missing ${name}`)
    return entry
  }

  switch (kind) {
    case 'docx':
      runsText(read(required('word/document.xml')), out, WORD, deadline)
      return
    case 'pptx':
      numbered(entries, /^ppt\/slides\/slide(\d+)\.xml$/).forEach((entry, i) => {
        if (out.full) return
        out.startUnit(`Diapositive ${i + 1}`)
        runsText(read(entry), out, DRAWING, deadline)
      })
      return
    case 'xlsx':
      spreadsheetText(entries, read, out, deadline)
      return
    default:
      openDocumentText(read(required('content.xml')), kind, out, deadline)
  }
}

interface RunsMarkup {
  text: string
  paragraph: string
  tab: string
  breaks: string[]
  cell: string
  row: string
  // Elements whose content is not document text (e.g. tab stop definitions).
  ignored: string[]
}

const WORD: RunsMarkup = {
  text: 'w:t',
  paragraph: 'w:p',
  tab: 'w:tab',
  breaks: ['w:br', 'w:cr'],
  cell: 'w:tc',
  row: 'w:tr',
  ignored: ['w:tabs'],
}

const DRAWING: RunsMarkup = {
  text: 'a:t',
  paragraph: 'a:p',
  tab: 'a:tab',
  breaks: ['a:br'],
  cell: 'a:tc',
  row: 'a:tr',
  ignored: [],
}

// Word and PowerPoint keep the text in runs (`w:t`, `a:t`): only those are read, so field codes
// and deleted text (`w:instrText`, `w:delText`) never appear.
function runsText(xml: string, out: TextCollector, m: RunsMarkup, deadline: number): void {
  let inText = false
  let ignored = 0
  walkXml(
    xml,
    {
      open(name, _attrs, selfClosing) {
        if (m.ignored.includes(name)) ignored++
        else if (ignored) return
        else if (name === m.text) inText = !selfClosing
        else if (name === m.tab) out.add('\t')
        else if (m.breaks.includes(name)) out.add('\n')
      },
      close(name) {
        if (m.ignored.includes(name)) ignored--
        else if (name === m.text) inText = false
        else if (name === m.paragraph) out.add('\n')
        else if (name === m.cell) out.endCell()
        else if (name === m.row) out.endRow()
      },
      text(value) {
        if (inText) out.add(value)
      },
    },
    deadline,
    () => out.full,
  )
}

// One unit per sheet, in the workbook's order; a row is its cells separated by tabs, at their
// column. Values are those saved in the file (formula results as last computed, dates as Excel
// serial numbers unless stored as text).
function spreadsheetText(
  entries: Map<string, ZipEntry>,
  read: (entry: ZipEntry) => string,
  out: TextCollector,
  deadline: number,
): void {
  const shared = sharedStrings(entries.get('xl/sharedStrings.xml'), read, deadline)
  const targets = new Map<string, string>()
  const rels = entries.get('xl/_rels/workbook.xml.rels')
  if (rels) {
    walkXml(
      read(rels),
      {
        open(name, attrs) {
          const id = attr(attrs, 'Id')
          const target = attr(attrs, 'Target')
          if (name !== 'Relationship' || !id || !target) return
          targets.set(id, target.startsWith('/') ? target.slice(1) : posix.join('xl', target))
        },
      },
      deadline,
    )
  }
  const workbook = entries.get('xl/workbook.xml')
  if (!workbook) throw new ZipFormatError('missing xl/workbook.xml')
  const sheets: Array<{ name: string; entry: ZipEntry }> = []
  walkXml(
    read(workbook),
    {
      open(name, attrs) {
        if (name !== 'sheet') return
        const entry = entries.get(targets.get(attr(attrs, 'r:id') ?? '') ?? '')
        if (entry) sheets.push({ name: attr(attrs, 'name') ?? '', entry })
      },
    },
    deadline,
  )
  for (const sheet of sheets) {
    if (out.full) return
    out.startUnit(`Feuille « ${sheet.name} »`)
    let row: string[] | null = null
    let cell: { column: number; type: string; value: string } | null = null
    let inValue = false
    walkXml(
      read(sheet.entry),
      {
        open(name, attrs, selfClosing) {
          if (name === 'row') row = []
          else if (name === 'c') {
            cell = {
              column: columnIndex(attr(attrs, 'r')) ?? row?.length ?? 0,
              type: attr(attrs, 't') ?? 'n',
              value: '',
            }
          } else if ((name === 'v' || name === 't') && cell) inValue = !selfClosing
        },
        close(name) {
          if (name === 'v' || name === 't') inValue = false
          else if (name === 'c' && cell && row) {
            const value = cellValue(cell, shared)
            if (value && cell.column < MAX_COLUMNS) row[cell.column] = value
            cell = null
          } else if (name === 'row' && row) {
            if (row.some(Boolean)) out.add(Array.from(row, (v) => v ?? '').join('\t') + '\n')
            row = null
          }
        },
        text(value) {
          if (inValue && cell) cell.value += value
        },
      },
      deadline,
      () => out.full,
    )
  }
}

function sharedStrings(
  entry: ZipEntry | undefined,
  read: (entry: ZipEntry) => string,
  deadline: number,
): string[] {
  const strings: string[] = []
  if (!entry) return strings
  let current: string | null = null
  let inText = false
  let phonetic = 0
  walkXml(
    read(entry),
    {
      open(name, _attrs, selfClosing) {
        if (name === 'si') current = ''
        else if (name === 'rPh') phonetic++
        else if (name === 't') inText = !selfClosing
      },
      close(name) {
        if (name === 'si') {
          strings.push(current ?? '')
          current = null
        } else if (name === 'rPh') phonetic--
        else if (name === 't') inText = false
      },
      text(value) {
        if (inText && !phonetic && current !== null) current += value
      },
    },
    deadline,
  )
  return strings
}

function cellValue(cell: { type: string; value: string }, shared: string[]): string {
  if (cell.type === 's') return shared[Number(cell.value)] ?? ''
  if (cell.type === 'b') return cell.value === '1' ? 'VRAI' : 'FAUX'
  return cell.value
}

// "AB12" → 27; undefined when the reference is absent or not a cell reference.
function columnIndex(ref: string | undefined): number | undefined {
  const letters = ref ? /^([A-Z]{1,3})\d+$/.exec(ref)?.[1] : undefined
  if (!letters) return undefined
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

// OpenDocument keeps the text in paragraphs (`text:p`, `text:h`); a spreadsheet's tables and a
// presentation's pages become units.
const SKIPPED_ODF = new Set([
  'text:tracked-changes',
  'office:annotation',
  'office:forms',
  'presentation:notes',
])

function openDocumentText(
  xml: string,
  kind: OfficeKind,
  out: TextCollector,
  deadline: number,
): void {
  let skipped = 0
  let paragraph = 0
  let slide = 0
  walkXml(
    xml,
    {
      open(name, attrs) {
        if (SKIPPED_ODF.has(name)) skipped++
        else if (skipped) return
        else if (kind === 'ods' && name === 'table:table') {
          out.startUnit(`Feuille « ${attr(attrs, 'table:name') ?? ''} »`)
        } else if (kind === 'odp' && name === 'draw:page') out.startUnit(`Diapositive ${++slide}`)
        else if (name === 'text:p' || name === 'text:h') paragraph++
        else if (!paragraph) return
        else if (name === 'text:s') {
          out.add(' '.repeat(Math.min(Number(attr(attrs, 'text:c') ?? 1) || 1, 100)))
        } else if (name === 'text:tab') out.add('\t')
        else if (name === 'text:line-break') out.add('\n')
      },
      close(name) {
        if (SKIPPED_ODF.has(name)) skipped--
        else if (skipped) return
        else if (name === 'text:p' || name === 'text:h') {
          paragraph--
          out.add('\n')
        } else if (name === 'table:table-cell' || name === 'table:covered-table-cell') {
          out.endCell()
        } else if (name === 'table:table-row') out.endRow()
      },
      text(value) {
        if (!skipped && paragraph) out.add(value)
      },
    },
    deadline,
    () => out.full,
  )
}

// Entries whose name matches `pattern` (with a number), in numeric order.
function numbered(entries: Map<string, ZipEntry>, pattern: RegExp): ZipEntry[] {
  return [...entries.values()]
    .map((entry) => ({ entry, n: Number(pattern.exec(entry.name)?.[1]) }))
    .filter(({ n }) => Number.isInteger(n))
    .sort((a, b) => a.n - b.n)
    .map(({ entry }) => entry)
}

interface XmlHandlers {
  open?(name: string, attrs: string, selfClosing: boolean): void
  close?(name: string): void
  text?(value: string): void
}

// Markup that cannot be read: an unterminated tag, comment or CDATA section.
export class XmlFormatError extends Error {}

// Office markup took longer to read than allowed: the reading stops instead of holding the server.
export class OfficeReadTimeout extends Error {}

const TAG = /^(\/?)([A-Za-z_][\w.:-]*)([\s\S]*)$/

// A minimal event reader, enough to pick text out of Office markup: no DTD, so no entity expansion
// beyond the predefined and numeric references. One forward pass with indexOf: every character is
// looked at a bounded number of times, and unterminated markup is refused at once (code review
// R51). The deadline is checked as it goes.
export function walkXml(
  xml: string,
  handlers: XmlHandlers,
  deadline: number,
  stop: () => boolean = () => false,
) {
  let at = 0
  let steps = 0
  const end = (marker: string, from: number): number => {
    const found = xml.indexOf(marker, from)
    if (found < 0) throw new XmlFormatError(`unterminated markup at ${at}`)
    return found
  }
  while (at < xml.length) {
    if (stop()) return
    if ((++steps & 0x3ff) === 0 && Date.now() > deadline) throw new OfficeReadTimeout()
    const lt = xml.indexOf('<', at)
    if (lt !== at) {
      handlers.text?.(decodeEntities(xml.slice(at, lt < 0 ? undefined : lt)))
      if (lt < 0) return
      at = lt
    }
    if (xml.startsWith('<![CDATA[', at)) {
      const close = end(']]>', at + 9)
      handlers.text?.(xml.slice(at + 9, close))
      at = close + 3
    } else if (xml.startsWith('<!--', at)) {
      at = end('-->', at + 4) + 3
    } else {
      const close = end('>', at + 1)
      const m = TAG.exec(xml.slice(at + 1, close))
      at = close + 1
      // Declarations, processing instructions and stray brackets carry no text.
      if (!m) continue
      if (m[1]) {
        handlers.close?.(m[2])
        continue
      }
      const selfClosing = m[3].endsWith('/')
      handlers.open?.(m[2], m[3], selfClosing)
      if (selfClosing) handlers.close?.(m[2])
    }
  }
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.:]/g, '\\$&')
  const m = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
  return m ? decodeEntities(m[1] ?? m[2]) : undefined
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
    const code =
      ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}
