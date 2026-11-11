import { HttpException, Injectable } from '@nestjs/common'
import type { Document } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DocumentsService } from '../documents/documents.service'
import { locateExcerpt } from '../documents/text/excerpt-location'
import { DOCUMENT_TEXT_LIMITS, extractDocumentText } from '../documents/text/document-text'
import type { TextUnit } from '../documents/text/text-collector'
import type { AnswerDeclaration, CheckedSource } from './answer-provenance'
import type { AnswerValidationError } from './answer-validation'

// Checks the sources an AI assistant cites for its answers (E04.04), before anything is written: a
// source is a document version of this very dossier, and a cited excerpt must be found in its text
// (the same text read_document returns). Confluent records where it found it; an invented source
// or quotation is refused.
@Injectable()
export class AnswerSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  // One entry per answer (null without a source), and the problems found.
  async check(
    dossierId: string,
    answers: ReadonlyArray<{ fieldId: string } & AnswerDeclaration>,
  ): Promise<{ sources: Array<CheckedSource | null>; errors: AnswerValidationError[] }> {
    const errors: AnswerValidationError[] = []
    const ids = [...new Set(answers.flatMap((a) => (a.source ? [a.source.documentId] : [])))]
    if (ids.length === 0) return { sources: answers.map(() => null), errors }
    const documents = await this.prisma.document.findMany({
      where: { dossierId, id: { in: ids } },
    })
    // Each cited document is read once, and only when an excerpt is to be found in it.
    const texts = new Map<string, TextUnit[] | string>()
    for (const document of documents) {
      if (answers.some((a) => a.source?.documentId === document.id && a.source.excerpt)) {
        texts.set(document.id, await this.textOf(dossierId, document))
      }
    }
    const sources = answers.map((answer): CheckedSource | null => {
      if (!answer.source) return null
      const fail = (message: string) => {
        errors.push({ fieldId: answer.fieldId, message })
        return null
      }
      const document = documents.find((d) => d.id === answer.source!.documentId)
      if (!document) {
        return fail(
          'Source introuvable : ce document n’appartient pas à ce dossier. Citez un documentId ' +
            'renvoyé par list_documents.',
        )
      }
      const excerpt = answer.source.excerpt?.trim()
      if (!excerpt) return { documentId: document.id, location: null, excerpt: null }
      const text = texts.get(document.id)!
      if (typeof text === 'string') return fail(text)
      const found = locateExcerpt(text, excerpt)
      if (!found.found) {
        return fail(
          `Extrait introuvable dans « ${document.filename} » (version ${document.version}) : ` +
            'recopiez quelques mots exactement tels que read_document les renvoie, ou citez le ' +
            'document sans extrait.',
        )
      }
      return { documentId: document.id, location: found.location, excerpt }
    })
    return { sources, errors }
  }

  // The text of a document version, or why an excerpt cannot be checked in it.
  private async textOf(dossierId: string, document: Document): Promise<TextUnit[] | string> {
    const unverifiable = (why: string) =>
      `Extrait invérifiable dans « ${document.filename} » : ${why} Citez le document sans extrait.`
    try {
      const { content } = await this.documents.readFile(dossierId, 'complet', document.id)
      const extracted = await extractDocumentText(content, document.mimetype, DOCUMENT_TEXT_LIMITS)
      return extracted.readable ? extracted.units : unverifiable(extracted.reason)
    } catch (err) {
      // File lost or storage unreachable: said as the documents API says it.
      if (err instanceof HttpException) return unverifiable(messageOf(err))
      throw err
    }
  }
}

function messageOf(err: HttpException): string {
  const body = err.getResponse()
  return typeof body === 'object' && body !== null && 'message' in body
    ? String((body as { message: unknown }).message)
    : err.message
}
