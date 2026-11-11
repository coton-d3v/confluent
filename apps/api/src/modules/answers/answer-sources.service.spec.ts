import { GoneException } from '@nestjs/common'
import { AnswerSourcesService } from './answer-sources.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { DocumentsService } from '../documents/documents.service'

const CSV = { id: 'doc-csv', filename: 'ca.csv', version: 2, mimetype: 'text/csv' }
const IMAGE = { id: 'doc-png', filename: 'kbis.png', version: 1, mimetype: 'image/png' }
const LOST = { id: 'doc-lost', filename: 'bp.txt', version: 1, mimetype: 'text/plain' }
// The documents a dossier presents are its company's (E05.05).
const D1 = { id: 'd-1', companyId: 'c-1' }

describe('AnswerSourcesService', () => {
  function build() {
    const findMany = jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve([CSV, IMAGE, LOST].filter((d) => where.id.in.includes(d.id))),
    )
    const readFile = jest.fn((_dossier: unknown, _level: string, id: string) => {
      if (id === LOST.id) {
        return Promise.reject(
          new GoneException({
            message: 'Le fichier de ce document est perdu : il doit être déposé de nouveau.',
          }),
        )
      }
      const content = id === CSV.id ? 'Année;CA\n2025;120 000\n' : '\x89PNG'
      return Promise.resolve({ document: {}, content: Buffer.from(content) })
    })
    const svc = new AnswerSourcesService(
      { document: { findMany } } as unknown as PrismaService,
      { readFile } as unknown as DocumentsService,
    )
    return { svc, findMany, readFile }
  }

  it('reads nothing when no answer cites a source', async () => {
    const { svc, findMany } = build()
    await expect(svc.check(D1, [{ fieldId: 'f-1' }])).resolves.toEqual({
      sources: [null],
      errors: [],
    })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('accepts a document of the dossier, finds a cited excerpt in it, reading it once', async () => {
    const { svc, findMany, readFile } = build()
    const result = await svc.check(D1, [
      { fieldId: 'f-1', source: { documentId: CSV.id, excerpt: ' 2025;120 000 ' } },
      { fieldId: 'f-2', source: { documentId: CSV.id, excerpt: 'Année;CA' } },
      { fieldId: 'f-3', source: { documentId: IMAGE.id } },
      { fieldId: 'f-4' },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'c-1', id: { in: [CSV.id, IMAGE.id] } },
    })
    // Read with the owner's level, only for the document an excerpt must be found in.
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledWith(D1, 'complet', CSV.id)
    expect(result).toEqual({
      sources: [
        { documentId: CSV.id, location: null, excerpt: '2025;120 000' },
        { documentId: CSV.id, location: null, excerpt: 'Année;CA' },
        { documentId: IMAGE.id, location: null, excerpt: null },
        null,
      ],
      errors: [],
    })
  })

  it('refuses another dossier’s document, an excerpt the document does not contain, or one it cannot check', async () => {
    const { svc } = build()
    const { sources, errors } = await svc.check(D1, [
      { fieldId: 'f-1', source: { documentId: 'doc-of-another-dossier' } },
      { fieldId: 'f-2', source: { documentId: CSV.id, excerpt: '2025;950 000' } },
      { fieldId: 'f-3', source: { documentId: IMAGE.id, excerpt: 'BIOSENSIO' } },
      { fieldId: 'f-4', source: { documentId: LOST.id, excerpt: 'BIOSENSIO' } },
    ])
    expect(sources).toEqual([null, null, null, null])
    expect(errors).toEqual([
      { fieldId: 'f-1', message: expect.stringContaining('Source introuvable') },
      {
        fieldId: 'f-2',
        message: expect.stringContaining('Extrait introuvable dans « ca.csv » (version 2)'),
      },
      { fieldId: 'f-3', message: expect.stringContaining('OCR') },
      { fieldId: 'f-4', message: expect.stringContaining('déposé de nouveau') },
    ])
  })
})
