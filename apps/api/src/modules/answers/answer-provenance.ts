import type { Document, DossierAnswer } from '@prisma/client'
import type {
  AnswerChannel,
  AnswerConfirmation,
  AnswerOrigin,
  AnswerProvenance,
} from '@confluent/shared'
import type { AnswerValidationError } from './answer-validation'

// Provenance of an answer's value (roadmap E04.04): recorded with the value, by the only write path
// (`AnswersService.saveForDossier`), and replaced by the next value — whatever its path.

// Who writes, through which channel: always taken from the session or the OAuth token, never from
// what a client declares.
export interface AnswerAuthor {
  userId: string
  channel: AnswerChannel
  // The AI application (OAuth client) for `mcp`.
  clientName?: string
}

// What an AI assistant declares about a value it sends (MCP). Absent: the person's own input.
export interface AnswerDeclaration {
  origin?: AnswerOrigin
  // For a proposal: the person explicitly confirmed this value.
  confirmedByUser?: boolean
  source?: { documentId: string; excerpt?: string }
}

// A cited source once checked against the dossier's documents: the location is where Confluent
// found the excerpt, never one declared by the client.
export interface CheckedSource {
  documentId: string
  location: string | null
  excerpt: string | null
}

// Never store an unbacked guess: a proposal the person has not confirmed must cite its document.
export function declarationErrors(
  answers: ReadonlyArray<{ fieldId: string } & AnswerDeclaration>,
): AnswerValidationError[] {
  return answers
    .filter((a) => a.origin === 'ai' && !a.confirmedByUser && !a.source)
    .map((a) => ({
      fieldId: a.fieldId,
      message:
        'Proposition non confirmée sans source : citez le document dont elle est tirée ' +
        '(source.documentId), ou faites d’abord confirmer la valeur par l’utilisateur.',
    }))
}

// An AI proposal the person has not confirmed yet (E04.05): it counts as an answer, and is shown
// as « à confirmer » until the person confirms or corrects it.
export function isPendingProposal(row: Pick<DossierAnswer, 'origin' | 'confirmation'>): boolean {
  return row.origin === 'ai' && row.confirmation === 'pending'
}

// The provenance columns written with a value.
export function provenanceColumns(
  answer: AnswerDeclaration,
  author: AnswerAuthor,
  source: CheckedSource | null,
) {
  const origin: AnswerOrigin = answer.origin ?? 'human'
  const confirmation: AnswerConfirmation =
    origin === 'human' || answer.confirmedByUser ? 'confirmed' : 'pending'
  return {
    origin,
    confirmation,
    channel: author.channel,
    authorId: author.userId,
    clientName: author.channel === 'mcp' ? (author.clientName ?? null) : null,
    sourceDocumentId: source?.documentId ?? null,
    sourceLocation: source?.location ?? null,
    sourceExcerpt: source?.excerpt ?? null,
  }
}

export type AnswerProvenanceView = Omit<AnswerProvenance, 'recordedAt'> & { recordedAt: Date }

// The provenance columns, shared by an answer and its revisions (E04.05).
export type StoredProvenance = Pick<
  DossierAnswer,
  | 'origin'
  | 'confirmation'
  | 'channel'
  | 'authorId'
  | 'clientName'
  | 'sourceDocumentId'
  | 'sourceLocation'
  | 'sourceExcerpt'
>

// The stored provenance, read defensively: an answer saved before it was recorded, or holding an
// unexpected value, has none (null) rather than a guessed one. `recordedAt`: when that state was
// written.
export function provenanceView(
  row: StoredProvenance,
  recordedAt: Date,
  documents: ReadonlyMap<string, Pick<Document, 'filename' | 'version'>>,
): AnswerProvenanceView | null {
  const { origin, confirmation, channel } = row
  if (
    (origin !== 'human' && origin !== 'ai') ||
    (confirmation !== 'confirmed' && confirmation !== 'pending') ||
    (channel !== 'site' && channel !== 'admin' && channel !== 'mcp')
  ) {
    return null
  }
  const document = row.sourceDocumentId ? documents.get(row.sourceDocumentId) : undefined
  const cited = row.sourceDocumentId !== null || row.sourceExcerpt !== null
  return {
    origin,
    confirmation,
    channel,
    authorId: row.authorId,
    clientName: row.clientName,
    recordedAt,
    source: cited
      ? {
          documentId: document ? row.sourceDocumentId : null,
          filename: document?.filename ?? null,
          version: document?.version ?? null,
          location: row.sourceLocation,
          excerpt: row.sourceExcerpt,
        }
      : null,
  }
}

type AnswerState = StoredProvenance & Pick<DossierAnswer, 'value'>

// Whether replacing `previous` by `next` keeps `previous` in the answer's history (E04.05): only when
// an AI assistant is involved — a proposal that gives way (corrected, replaced, confirmed), or a
// value that gives way to a proposal. The person's own successive edits (autosave) are not kept,
// nor an empty value, nor a write that changes nothing.
export function keepsRevision(previous: AnswerState, next: AnswerState): boolean {
  const changed =
    previous.value !== next.value ||
    previous.origin !== next.origin ||
    previous.confirmation !== next.confirmation ||
    previous.clientName !== next.clientName ||
    previous.sourceDocumentId !== next.sourceDocumentId ||
    previous.sourceExcerpt !== next.sourceExcerpt
  if (!changed) return false
  if (previous.origin === 'ai') return true
  return next.origin === 'ai' && previous.value !== ''
}

// The revision row keeping `previous`, a state that gives way.
export function revisionOf(previous: DossierAnswer) {
  return {
    answerId: previous.id,
    value: previous.value,
    origin: previous.origin,
    confirmation: previous.confirmation,
    channel: previous.channel,
    authorId: previous.authorId,
    clientName: previous.clientName,
    sourceDocumentId: previous.sourceDocumentId,
    sourceLocation: previous.sourceLocation,
    sourceExcerpt: previous.sourceExcerpt,
    recordedAt: previous.updatedAt,
  }
}
