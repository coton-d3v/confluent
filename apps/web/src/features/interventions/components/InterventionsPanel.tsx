import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  CANDIDATURE_NOTE_LIMITS,
  FINANCING_STATUS_LABELS,
  FUNDING_PLAN_LINE_STATE_LABELS,
  createCandidatureNoteSchema,
  fundingPlanLineStateOf,
  type CandidatureNote,
  type Intervention,
  type InterventionJournal,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { formatAmount } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import {
  createCandidatureNote,
  deleteCandidatureNote,
  getInterventionJournal,
  updateCandidatureNote,
} from '../api'

const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

const nameOf = (member: Intervention['actor']) =>
  member
    ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
    : 'un compte supprimé'

const failure = (err: unknown, fallback: string) => {
  const e = err as Partial<ApiError> | undefined
  return e?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (e.message ?? fallback)
}

// What the API refuses, checked before sending: the message of the first problem.
const bodyError = (body: string) => {
  const parsed = createCandidatureNoteSchema.safeParse({ body })
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Saisie invalide.')
}

type Filter = 'all' | 'notes'

// ROADMAP E06.08: the internal notes of the structure on a candidature it received, and the journal
// of its interventions on it — notes, financing statuses, plan lines, eligibilities and validated
// steps —, the latest first. Read by the workspace's conseillers only: the entrepreneur, the
// investors and the other structures never see them. Only its author rewrites or deletes a note; a
// note changed meanwhile is refused by the API and the journal reloaded. The other panels of the page
// write their own interventions: « Actualiser » reads them here.
export function InterventionsPanel({
  workspaceId,
  candidatureId,
}: {
  workspaceId: string
  candidatureId: string
}) {
  const query = useAsync(
    () => getInterventionJournal(workspaceId, candidatureId),
    [workspaceId, candidatureId],
  )
  const [current, setCurrent] = useState<InterventionJournal | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [reloading, setReloading] = useState(false)
  const data = current ?? query.data ?? null

  async function reload() {
    setReloading(true)
    try {
      setCurrent(await getInterventionJournal(workspaceId, candidatureId))
    } catch (err) {
      toast.error(failure(err, 'Le journal n’a pas pu être rechargé.'))
    } finally {
      setReloading(false)
    }
  }

  return (
    <section
      aria-labelledby="interventions-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="interventions-title" className="font-heading text-lg font-semibold text-foreground">
        Notes internes et journal
      </h2>
      <p className="text-sm text-muted-foreground">
        Réservé aux conseillers de votre structure : l’entreprise, les investisseurs et les autres
        structures ne voient ni ces notes ni ce journal. Chaque note reste modifiable ou supprimable
        par son seul auteur.
      </p>
      {data ? (
        <>
          <NoteComposer
            onSubmit={async (body) =>
              setCurrent(await createCandidatureNote(workspaceId, candidatureId, { body }))
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Afficher" className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'Tout le journal'],
                  ['notes', 'Notes seulement'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={filter === value ? 'default' : 'outline'}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={reloading}
              onClick={() => void reload()}
            >
              Actualiser
            </Button>
          </div>
          <Journal
            entries={data.entries.filter((e) => filter === 'all' || e.kind === 'note')}
            filter={filter}
            onEdit={async (note, body) =>
              setCurrent(
                await updateCandidatureNote(workspaceId, candidatureId, note.id, {
                  body,
                  version: note.version,
                }),
              )
            }
            onDelete={async (note) =>
              setCurrent(
                await deleteCandidatureNote(workspaceId, candidatureId, note.id, note.version),
              )
            }
            onStale={() => void reload()}
          />
        </>
      ) : query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {failure(query.error, 'Les notes internes n’ont pas pu être chargées.')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
    </section>
  )
}

function NoteComposer({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const ids = { body: useId(), hint: useId(), error: useId() }
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = bodyError(body)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await onSubmit(body)
      setBody('')
      setError(null)
      toast.success('Note ajoutée.')
    } catch (err) {
      setError(failure(err, 'La note n’a pas été enregistrée.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" noValidate>
      <Label htmlFor={ids.body}>Nouvelle note interne</Label>
      <Textarea
        id={ids.body}
        value={body}
        rows={3}
        maxLength={CANDIDATURE_NOTE_LIMITS.body}
        aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setBody(e.target.value)
          if (error) setError(null)
        }}
      />
      <p id={ids.hint} className="text-xs text-muted-foreground">
        Texte simple, {CANDIDATURE_NOTE_LIMITS.body.toLocaleString('fr-FR')} caractères au plus (
        {body.length.toLocaleString('fr-FR')} saisis).
      </p>
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={busy}>
          Ajouter la note
        </Button>
      </div>
    </form>
  )
}

function Journal({
  entries,
  filter,
  onEdit,
  onDelete,
  onStale,
}: {
  entries: Intervention[]
  filter: Filter
  onEdit: (note: CandidatureNote, body: string) => Promise<void>
  onDelete: (note: CandidatureNote) => Promise<void>
  onStale: () => void
}) {
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {filter === 'notes'
          ? 'Aucune note interne pour l’instant.'
          : 'Aucune intervention de votre structure sur cette candidature pour l’instant.'}
      </p>
    )
  }
  return (
    <>
      <ol aria-label="Journal des interventions" className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1 py-3">
            <p className="text-xs text-muted-foreground wrap-anywhere">
              {dateTimeFr(entry.at)} · {nameOf(entry.actor)}
            </p>
            {entry.kind === 'note' ? (
              <NoteItem
                note={entry.note}
                author={nameOf(entry.actor)}
                onEdit={onEdit}
                onStale={onStale}
                onAskDelete={() =>
                  setConfirm({
                    title: 'Supprimer cette note ?',
                    description:
                      'Son texte sera effacé définitivement ; le journal gardera seulement la trace « note supprimée », datée.',
                    confirmLabel: 'Supprimer la note',
                    onConfirm: () =>
                      void onDelete(entry.note).then(
                        () => toast.success('Note supprimée.'),
                        (err: unknown) => {
                          toast.error(failure(err, 'La note n’a pas été supprimée.'))
                          const status = (err as Partial<ApiError> | undefined)?.status
                          if (status === 409 || status === 404) onStale()
                        },
                      ),
                  })
                }
              />
            ) : (
              <p className="text-sm text-foreground wrap-anywhere">{describe(entry)}</p>
            )}
          </li>
        ))}
      </ol>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

// The draft is tied to the version it was started from (code review R61): saving always sends that
// version, so a note changed meanwhile — even when the journal was reloaded while editing — is
// refused (409) instead of being overwritten. On a conflict or a deletion the draft stays on screen
// next to the current text, to be copied or applied deliberately on the current version.
interface NoteDraft {
  body: string
  version: number
}

function NoteItem({
  note,
  author,
  onEdit,
  onStale,
  onAskDelete,
}: {
  note: CandidatureNote
  author: string
  onEdit: (note: CandidatureNote, body: string) => Promise<void>
  onStale: () => void
  onAskDelete: () => void
}) {
  const ids = { body: useId(), error: useId() }
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const deleted = note.body === null
  // A newer version (another tab, another save) arrived while editing.
  const outdated = draft !== null && !deleted && note.version !== draft.version

  function close() {
    setDraft(null)
    setError(null)
  }

  if (deleted && draft === null) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Note supprimée{note.deletedAt ? ` le ${dateTimeFr(note.deletedAt)}` : ''} par son auteur.
      </p>
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (draft === null || deleted) return
    const problem = bodyError(draft.body)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await onEdit({ ...note, version: draft.version }, draft.body)
      close()
      toast.success('Note modifiée.')
    } catch (err) {
      const status = (err as Partial<ApiError> | undefined)?.status
      if (status === 409 || status === 404) {
        // Keep the draft: the journal reloads underneath with the current note.
        setError(
          status === 404
            ? 'La note a été supprimée entre-temps : votre texte n’a pas été enregistré.'
            : 'La note a été modifiée entre-temps : votre texte n’a pas été enregistré. Comparez-le à la version actuelle avant de l’appliquer.',
        )
        onStale()
      } else {
        setError(failure(err, 'La note n’a pas été modifiée.'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (draft !== null) {
    return (
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2" noValidate>
        {(outdated || deleted) && (
          <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            {deleted ? (
              <p>Cette note a été supprimée pendant que vous la modifiiez.</p>
            ) : (
              <>
                <p className="font-medium">
                  Cette note a été modifiée pendant que vous la modifiiez. Version actuelle :
                </p>
                <p className="mt-1 text-foreground wrap-anywhere whitespace-pre-line">
                  {note.body}
                </p>
              </>
            )}
          </div>
        )}
        <Label htmlFor={ids.body} className="sr-only">
          Modifier la note
        </Label>
        <Textarea
          id={ids.body}
          value={draft.body}
          rows={4}
          readOnly={deleted}
          maxLength={CANDIDATURE_NOTE_LIMITS.body}
          aria-describedby={error ? ids.error : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft({ ...draft, body: e.target.value })
            if (error) setError(null)
          }}
        />
        {error && (
          <p id={ids.error} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!deleted && !outdated && (
            <Button type="submit" size="sm" disabled={busy}>
              Enregistrer
            </Button>
          )}
          {outdated && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft({ ...draft, version: note.version })
                setError(null)
              }}
            >
              Appliquer mon texte à la version actuelle
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>
            {deleted || outdated ? 'Abandonner mon texte' : 'Annuler'}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <>
      <p className="text-sm text-foreground wrap-anywhere whitespace-pre-line">{note.body}</p>
      {note.editedAt && (
        <p className="text-xs text-muted-foreground">Modifiée le {dateTimeFr(note.editedAt)}</p>
      )}
      {note.mine && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Modifier la note de ${author} du ${dateTimeFr(note.createdAt)}`}
            onClick={() => setDraft({ body: note.body ?? '', version: note.version })}
          >
            Modifier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Supprimer la note de ${author} du ${dateTimeFr(note.createdAt)}`}
            onClick={onAskDelete}
          >
            Supprimer
          </Button>
        </div>
      )}
    </>
  )
}

const amountText = (v: string | number | null) =>
  typeof v === 'number' ? (formatAmount(v) ?? '—') : '—'
const stateText = (v: string | number | null) =>
  typeof v === 'string'
    ? FUNDING_PLAN_LINE_STATE_LABELS[fundingPlanLineStateOf(v)].toLowerCase()
    : '—'

const PLAN_FIELD_LABELS = {
  category: 'source',
  label: 'précision',
  amountEur: 'montant',
  state: 'état',
} as const

// One intervention other than a note, in words.
function describe(entry: Exclude<Intervention, { kind: 'note' }>): ReactNode {
  switch (entry.kind) {
    case 'financing_status':
      return `Statut de financement : ${FINANCING_STATUS_LABELS[entry.from]} → ${FINANCING_STATUS_LABELS[entry.to]}.`
    case 'support_step':
      return entry.change === 'validated'
        ? `Étape « ${entry.step.label} » validée.`
        : `Validation de l’étape « ${entry.step.label} » retirée.`
    case 'funding_plan': {
      const source = entry.category ? ` « ${entry.category} »` : ''
      if (entry.change === 'updated') {
        const changes = entry.changes.map((c) =>
          c.field === 'amountEur'
            ? `montant ${amountText(c.from)} → ${amountText(c.to)}`
            : c.field === 'state'
              ? `état ${stateText(c.from)} → ${stateText(c.to)}`
              : `${PLAN_FIELD_LABELS[c.field]} ${c.from ?? '—'} → ${c.to ?? '—'}`,
        )
        return `Plan de financement : ligne${source} modifiée${changes.length ? ` (${changes.join(' ; ')})` : ''}.`
      }
      const line = entry.line
        ? [
            formatAmount(entry.line.amountEur),
            entry.line.state && FUNDING_PLAN_LINE_STATE_LABELS[entry.line.state].toLowerCase(),
            entry.line.label,
          ]
            .filter(Boolean)
            .join(', ')
        : ''
      return `Plan de financement : ligne${source} ${entry.change === 'created' ? 'ajoutée' : 'supprimée'}${line ? ` (${line})` : ''}.`
    }
    case 'eligibility': {
      const scheme = entry.scheme ? ` « ${entry.scheme} »` : ''
      if (entry.change === 'declared') {
        return `Éligibilité${scheme} indiquée${entry.verified ? ' et vérifiée' : ''}.`
      }
      if (entry.change === 'removed') return `Éligibilité${scheme} retirée.`
      const what = [
        entry.verified === true && 'vérifiée par la structure',
        entry.verified === false && 'vérification retirée',
        entry.noteChanged && 'précision modifiée',
      ].filter(Boolean)
      return `Éligibilité${scheme} : ${what.length ? what.join(', ') : 'modifiée'}.`
    }
  }
}
