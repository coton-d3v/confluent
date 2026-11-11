import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnswerProvenance as Provenance, AnswerRevision, AnswerRow } from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { confirmAnswer } from '@/features/dossiers/answers.api'
import type { ApiError } from '@/lib/api-client'
import {
  formatDateTime,
  hasOriginToShow,
  isPendingProposal,
  provenanceLabel,
  sourceLabel,
} from '@/features/questionnaire/provenance'

// Where an answer comes from, for the dossier's owner (E04.05): an AI proposal to confirm or
// correct, a confirmed one, and the states the answer held before. A cited excerpt is document
// content: it is shown as plain text, never interpreted.

function Source({ source }: { source: NonNullable<Provenance['source']> }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">Source : {sourceLabel(source)}</p>
      {source.excerpt && (
        <blockquote className="mt-1 whitespace-pre-line break-words border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
          « {source.excerpt} »
        </blockquote>
      )}
    </>
  )
}

// A proposal waiting for the person: who proposed it, when, from which document; « Confirmer »
// keeps the value as shown, « Corriger » (when given) opens the question.
export function ProposalNotice({
  dossierId,
  label,
  row,
  onConfirmed,
  correctHref,
}: {
  dossierId: string
  // The question's label, naming the actions for screen readers.
  label: string
  row: AnswerRow
  onConfirmed: (row: AnswerRow) => void
  correctHref?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const provenance = row.provenance!

  async function confirm() {
    setConfirming(true)
    setError(null)
    try {
      onConfirmed(await confirmAnswer(dossierId, row.fieldId, { value: row.value, updatedAt: row.updatedAt }))
    } catch (err) {
      setError((err as ApiError)?.message ?? 'La confirmation a échoué. Réessayez.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-status-pending/50 bg-status-pending/10 px-3 py-2 text-sm font-normal">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
        <Badge className="bg-status-pending/25 text-foreground">À confirmer</Badge>
        <span>
          {provenanceLabel(provenance)} le {formatDateTime(provenance.recordedAt)}
        </span>
      </p>
      {provenance.source && (
        <div>
          <Source source={provenance.source} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-9 px-3"
          onClick={() => void confirm()}
          disabled={confirming}
          aria-label={`Confirmer la proposition : ${label}`}
        >
          {confirming ? 'Confirmation…' : 'Confirmer'}
        </Button>
        {correctHref ? (
          <Link
            to={correctHref}
            aria-label={`Corriger la proposition : ${label}`}
            className="inline-flex h-9 items-center px-2 text-xs text-foreground underline underline-offset-4"
          >
            Corriger
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">ou modifiez la valeur pour la corriger.</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function HistoryEntry({
  entry,
  formatValue,
}: {
  entry: AnswerRevision
  formatValue: (value: string) => string
}) {
  const p = entry.provenance
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <p className="whitespace-pre-line break-words text-[13px] text-foreground">
        {entry.value ? formatValue(entry.value) : <span className="text-muted-foreground">(vide)</span>}
      </p>
      <p className="text-xs text-muted-foreground">
        {p
          ? `${provenanceLabel(p)}${p.origin === 'ai' && p.confirmation === 'pending' ? ' (à confirmer)' : ''} le ${formatDateTime(p.recordedAt)}`
          : 'Provenance inconnue'}
        {' · remplacée le '}
        {formatDateTime(entry.replacedAt)}
      </p>
      {p?.source && <Source source={p.source} />}
    </li>
  )
}

// The answer's provenance block: the proposal to confirm, or the line saying an AI proposed it,
// then its history. Nothing for the person's own input without history, nor for a shared reader.
export function AnswerOrigin({
  dossierId,
  label,
  row,
  onConfirmed,
  correctHref,
  formatValue,
}: {
  dossierId: string
  label: string
  row: AnswerRow | undefined
  onConfirmed: (row: AnswerRow) => void
  correctHref?: string
  formatValue: (value: string) => string
}) {
  const provenance = row?.provenance
  const history = row?.history ?? []
  const pending = isPendingProposal(row)
  const confirmedProposal = provenance?.origin === 'ai' && !pending
  if (!row || !hasOriginToShow(row)) return null
  return (
    <div className="flex flex-col gap-2 font-normal">
      {pending && (
        <ProposalNotice
          dossierId={dossierId}
          label={label}
          row={row}
          onConfirmed={onConfirmed}
          correctHref={correctHref}
        />
      )}
      {confirmedProposal && provenance && (
        <div>
          <p className="text-xs text-muted-foreground">
            {provenanceLabel(provenance)} le {formatDateTime(provenance.recordedAt)}
          </p>
          {provenance.source && <Source source={provenance.source} />}
        </div>
      )}
      {history.length > 0 && (
        <details className="group text-xs">
          <summary className="inline-flex min-h-9 cursor-pointer items-center text-muted-foreground hover:text-foreground">
            Historique ({history.length})
          </summary>
          <ol className="mt-1 flex flex-col divide-y divide-border border-l-2 border-border pl-3">
            {history.map((entry, i) => (
              <HistoryEntry key={`${entry.replacedAt}-${i}`} entry={entry} formatValue={formatValue} />
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
