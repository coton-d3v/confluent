import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  documentTypeOf,
} from '@confluent/shared'
import { detectDocumentType, RECOGNISED_EXTENSIONS } from './document-types'

const bytes = (...b: number[]) => Buffer.from(b)
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00)

describe('detectDocumentType', () => {
  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n…'), 'x.bin', 'application/pdf'],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'x', 'image/png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0), 'photo.JPG', 'image/jpeg'],
    ['WebP', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'), 'x.webp', 'image/webp'],
    ['HEIC', Buffer.from('\x00\x00\x00\x18ftypheic', 'latin1'), 'IMG_1.HEIC', 'image/heic'],
    [
      'Word',
      ZIP,
      'statuts.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['OpenDocument', ZIP, 'bp.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    ['Excel 97', OLE, 'bilan.XLS', 'application/vnd.ms-excel'],
    ['UTF-8 CSV', Buffer.from('nom;montant\nÉté;12\n'), 'export.csv', 'text/csv'],
    [
      'Windows-1252 CSV',
      Buffer.from('nom;montant\r\n\xc9t\xe9;12\r\n', 'latin1'),
      'a.csv',
      'text/csv',
    ],
    ['text', Buffer.from('notes\tlibres'), 'notes.txt', 'text/plain'],
  ])('accepts %s', (_label, content, filename, expected) => {
    expect(detectDocumentType(content, filename)).toBe(expected)
  })

  it.each([
    ['an executable named as a PDF', Buffer.from('MZ\x90\x00', 'latin1'), 'statuts.pdf'],
    ['a bare zip archive', ZIP, 'pieces.zip'],
    ['a zip renamed with an image extension', ZIP, 'photo.png'],
    ['an OLE container with an unknown extension', OLE, 'setup.msi'],
    ['binary data named as CSV', bytes(0x00, 0x01, 0x02), 'export.csv'],
    ['text containing NUL bytes', Buffer.from('notes\x00'), 'notes.txt'],
    ['an empty text file', Buffer.alloc(0), 'vide.txt'],
    [
      'an SVG image (scriptable)',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'logo.svg',
    ],
  ])('refuses %s', (_label, content, filename) => {
    expect(detectDocumentType(content, filename)).toBeNull()
  })

  it('recognises exactly the extensions the site offers', () => {
    expect([...RECOGNISED_EXTENSIONS].sort()).toEqual([...ACCEPTED_DOCUMENT_EXTENSIONS].sort())
  })
})

// E05.06: the closed list of library document types is the same in the contract and in the
// database's CHECK constraint.
describe('library document types', () => {
  it('match the library_documents_type_check constraint of the migration', () => {
    const sql = readFileSync(
      join(__dirname, '../../../prisma/migrations/20261112200000_document_library/migration.sql'),
      'utf8',
    )
    const check = /library_documents_type_check" CHECK \("type" IN \(([^)]*)\)\)/.exec(sql)
    expect(check).not.toBeNull()
    const inDatabase = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(inDatabase).toEqual([...DOCUMENT_TYPES])
    expect(Object.keys(DOCUMENT_TYPE_LABELS)).toEqual([...DOCUMENT_TYPES])
  })

  it('reads an unknown or missing value as `other`', () => {
    expect(documentTypeOf('cap_table')).toBe('cap_table')
    expect(documentTypeOf('passport')).toBe('other')
    expect(documentTypeOf(null)).toBe('other')
  })
})
