import type { AnswerProvenance, AnswerRow } from '@confluent/shared'

// How the site tells where an answer comes from (E04.05). Only the owner receives a provenance;
// a financeur's answers have none, so nothing here ever shows to them.

// A value proposed by an AI assistant that the person has not confirmed yet.
export function isPendingProposal(row: AnswerRow | undefined): boolean {
  return row?.provenance?.origin === 'ai' && row.provenance.confirmation === 'pending'
}

// Something to say about where the answer comes from: an AI proposal (to confirm or confirmed),
// or earlier states. The person's own input without history needs nothing.
export function hasOriginToShow(row: AnswerRow | undefined): boolean {
  return row?.provenance?.origin === 'ai' || (row?.history?.length ?? 0) > 0
}

const assistant = (p: AnswerProvenance) => p.clientName ?? 'un assistant IA'

// Who wrote a state, and through which channel.
export function provenanceLabel(p: AnswerProvenance): string {
  if (p.origin === 'ai') {
    if (p.confirmation === 'pending') return `Proposée par ${assistant(p)}`
    if (p.channel === 'mcp') return `Proposée par ${assistant(p)}, confirmée dans la conversation`
    return 'Proposition IA confirmée dans Confluent'
  }
  if (p.channel === 'mcp') return `Donnée dans une conversation avec ${assistant(p)}`
  if (p.channel === 'admin') return 'Modifiée par l’administration'
  return 'Saisie dans Confluent'
}

// « bp.pdf (version 2) · Page 3 »; the document may have been deleted since.
export function sourceLabel(source: NonNullable<AnswerProvenance['source']>): string {
  const document = source.filename
    ? `${source.filename}${source.version ? ` (version ${source.version})` : ''}`
    : 'Document supprimé depuis'
  return source.location ? `${document} · ${source.location}` : document
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
