// Accepted document formats (ACCEPTED_DOCUMENT_EXTENSIONS, shared with the site), recognised from the
// file content rather than from the type or
// extension sent by the browser (ROADMAP E02.04). The detected type is what gets stored and served.

const OOXML_AND_ODF: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
}

const LEGACY_OFFICE: Record<string, string> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
}

const PLAIN_TEXT: Record<string, string> = {
  csv: 'text/csv',
  txt: 'text/plain',
}

// Extensions recognised below; kept equal to ACCEPTED_DOCUMENT_EXTENSIONS by a test.
export const RECOGNISED_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
  'heif',
  ...Object.keys(OOXML_AND_ODF),
  ...Object.keys(LEGACY_OFFICE),
  ...Object.keys(PLAIN_TEXT),
]

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b)
const ascii = (buf: Buffer, start: number, end: number) =>
  buf.subarray(start, end).toString('latin1')

const extensionOf = (filename: string) => /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase() ?? ''

// The MIME type of an accepted document, or null when the content is not an accepted format.
export function detectDocumentType(buffer: Buffer, filename: string): string | null {
  if (ascii(buffer, 0, 5) === '%PDF-') return 'application/pdf'
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'image/webp'
  if (
    ascii(buffer, 4, 8) === 'ftyp' &&
    /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(buffer, 8, 12))
  ) {
    return 'image/heic'
  }
  const ext = extensionOf(filename)
  // Office containers carry no format of their own in the first bytes: the container is checked
  // and the extension says which document it holds. A bare zip archive is not accepted.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return OOXML_AND_ODF[ext] ?? null
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return LEGACY_OFFICE[ext] ?? null
  }
  if (PLAIN_TEXT[ext] && buffer.length > 0 && isText(buffer)) return PLAIN_TEXT[ext]
  return null
}

// Text in any 8-bit or UTF-8 encoding (spreadsheets often export CSV in Windows-1252): no control
// characters other than tab, line breaks, form feed and escape.
function isText(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b) || byte === 0x7f) return false
  }
  return true
}
