import { LEGACY_OFFICE, OOXML_AND_ODF, PLAIN_TEXT } from '../document-types'
import {
  extractOfficeText,
  OfficeReadTimeout,
  XmlFormatError,
  type OfficeKind,
} from './office-text'
import { extractPdfText } from './pdf-text'
import { TextCollector, type TextUnit } from './text-collector'
import { ZipFormatError } from './zip-entries'

// Which accepted formats the API can read as text (E04.03), by the type recognised at upload. The
// single source of truth for the formats announced to MCP clients and in docs/mcp.md. No OCR: the
// text of an image, or of a scanned PDF, is not read.
type Reader = 'pdf' | 'plain' | OfficeKind

const READERS: Record<string, Reader> = {
  'application/pdf': 'pdf',
  [PLAIN_TEXT.txt]: 'plain',
  [PLAIN_TEXT.csv]: 'plain',
  [OOXML_AND_ODF.docx]: 'docx',
  [OOXML_AND_ODF.xlsx]: 'xlsx',
  [OOXML_AND_ODF.pptx]: 'pptx',
  [OOXML_AND_ODF.odt]: 'odt',
  [OOXML_AND_ODF.ods]: 'ods',
  [OOXML_AND_ODF.odp]: 'odp',
}

const OCR_UNAVAILABLE =
  'Image : la lecture du texte d’une image (OCR) n’est pas disponible. Demandez à l’utilisateur les informations utiles, ou un PDF dont le texte est sélectionnable.'
const LEGACY_FORMAT =
  'Ancien format Office (.doc, .xls, .ppt) : sa lecture n’est pas disponible. Une version .docx, .xlsx, .pptx ou PDF serait lisible.'

const NOT_READABLE: Record<string, string> = {
  'image/png': OCR_UNAVAILABLE,
  'image/jpeg': OCR_UNAVAILABLE,
  'image/webp': OCR_UNAVAILABLE,
  'image/heic': OCR_UNAVAILABLE,
  [LEGACY_OFFICE.doc]: LEGACY_FORMAT,
  [LEGACY_OFFICE.xls]: LEGACY_FORMAT,
  [LEGACY_OFFICE.ppt]: LEGACY_FORMAT,
}

export const READABLE_FORMATS_LABEL =
  'PDF dont le texte est sélectionnable, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument (.odt, .ods, .odp), CSV et texte (.txt)'
export const NOT_READABLE_FORMATS_LABEL =
  'images (PNG, JPEG, WebP, HEIC) et PDF scannés : lecture/OCR non disponible ; anciens formats Office (.doc, .xls, .ppt) : non lus'

const SCANNED_PDF =
  'PDF sans texte lisible (document scanné ou composé d’images) : la lecture OCR n’est pas disponible. Demandez à l’utilisateur les informations utiles, ou un PDF dont le texte est sélectionnable.'
const PROTECTED_PDF = 'PDF protégé par un mot de passe : son contenu ne peut pas être lu.'
const DAMAGED =
  'Document illisible : fichier endommagé, protégé ou dont la structure n’est pas reconnue.'
const TOO_SLOW =
  'Lecture interrompue : document trop long ou trop complexe à lire. Demandez à l’utilisateur les informations utiles.'
const BUSY = 'Lecture des documents momentanément saturée : réessayez dans quelques instants.'

// A page with fewer visible characters than this has no usable text layer (an image, a scan).
const MIN_PAGE_CHARS = 5

export type DocumentReading =
  | { readable: true; note?: string }
  | { readable: false; reason: string }

// Whether a format can be read, before reading it. Closed by default: an unknown type is not read.
export function readingOf(mimetype: string): DocumentReading {
  const reader = READERS[mimetype]
  if (reader === 'pdf') {
    return {
      readable: true,
      note: 'Lisible si son texte est sélectionnable ; un PDF scanné ne l’est pas (OCR non disponible).',
    }
  }
  if (reader) return { readable: true }
  return {
    readable: false,
    reason: NOT_READABLE[mimetype] ?? 'Format dont la lecture n’est pas disponible.',
  }
}

export interface ExtractionLimits {
  maxChars: number
  maxPdfPages: number
  // Office files are read on the main thread: past this time the reading stops (code review R51).
  officeTimeLimitMs?: number
}

const OFFICE_TIME_LIMIT_MS = 2_000

// What is read of a document at most, for MCP clients (read_document) and to find a cited excerpt:
// both see the same text.
export const DOCUMENT_TEXT_LIMITS: ExtractionLimits = { maxChars: 400_000, maxPdfPages: 300 }

export type ExtractedText =
  | {
      readable: true
      units: TextUnit[]
      // Text past the limits was not read.
      truncated: boolean
      // Units without readable text (e.g. scanned pages of a PDF that otherwise has text).
      unitsWithoutText: string[]
    }
  | { readable: false; reason: string }

export async function extractDocumentText(
  content: Buffer,
  mimetype: string,
  limits: ExtractionLimits,
): Promise<ExtractedText> {
  const reader = READERS[mimetype]
  if (!reader)
    return { readable: false, reason: (readingOf(mimetype) as { reason: string }).reason }
  if (reader === 'pdf') return pdfText(content, limits)
  const out = new TextCollector(limits.maxChars)
  if (reader === 'plain') {
    out.add(decodePlainText(content))
  } else {
    try {
      extractOfficeText(content, reader, out, limits.officeTimeLimitMs ?? OFFICE_TIME_LIMIT_MS)
    } catch (err) {
      if (err instanceof ZipFormatError || err instanceof XmlFormatError) {
        return { readable: false, reason: DAMAGED }
      }
      if (err instanceof OfficeReadTimeout) return { readable: false, reason: TOO_SLOW }
      throw err
    }
  }
  const units = out.finish()
  if (!units.some((u) => u.text)) {
    return { readable: false, reason: 'Le document ne contient aucun texte.' }
  }
  return { readable: true, units, truncated: out.truncated, unitsWithoutText: [] }
}

async function pdfText(content: Buffer, limits: ExtractionLimits): Promise<ExtractedText> {
  const result = await extractPdfText(content, {
    maxPages: limits.maxPdfPages,
    maxChars: limits.maxChars,
  })
  if (!result.ok) {
    const reason = {
      password: PROTECTED_PDF,
      invalid: DAMAGED,
      timeout: TOO_SLOW,
      busy: BUSY,
    }[result.error]
    return { readable: false, reason }
  }
  const out = new TextCollector(limits.maxChars)
  const withoutText: string[] = []
  result.pages.forEach((text, i) => {
    const label = `Page ${i + 1}`
    out.startUnit(label)
    if (text.replace(/\s/g, '').length < MIN_PAGE_CHARS) {
      withoutText.push(label)
      out.add('[Aucun texte lisible sur cette page : image ou scan, OCR non disponible.]')
    } else out.add(text)
  })
  if (withoutText.length === result.pages.length) return { readable: false, reason: SCANNED_PDF }
  return {
    readable: true,
    units: out.finish(),
    truncated: out.truncated || result.pages.length < result.numPages,
    unitsWithoutText: withoutText,
  }
}

// UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (spreadsheets often export CSV in it).
function decodePlainText(content: Buffer): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    text = new TextDecoder('windows-1252').decode(content)
  }
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}
