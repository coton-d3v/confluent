import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ELIGIBILITY_SCHEME_LIMITS,
  declareEligibilitySchema,
  type CandidatureEligibilities,
  type CandidatureEligibility,
  type EligibilitySide,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import {
  declareEligibility,
  getEligibilities,
  removeEligibility,
  updateEligibility,
  type EligibilityScope,
} from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const failure = (err: unknown, fallback: string) => {
  const e = err as Partial<ApiError> | undefined
  return e?.status === undefined
    ? `${fallback} Vérifiez votre connexion puis réessayez.`
    : (e.message ?? fallback)
}

// ROADMAP E06.05: a candidature's eligibilities to the schemes of its workspace (JEIR, JEI, CIR…),
// kept from either side — declarative information, never a tax simulation. The workspace alone
// marks one verified; the owner's change of note withdraws that verification (the API decides). An
// eligibility changed meanwhile by the other side is refused, the list is then reloaded.
export function EligibilitiesPanel({
  scope,
  intro,
  describeSide,
}: {
  scope: EligibilityScope
  intro: ReactNode
  // Who declared or wrote an eligibility, as this viewer may know it (« par vous »…).
  describeSide: (side: EligibilitySide) => string
}) {
  const query = useAsync(() => getEligibilities(scope), [JSON.stringify(scope)])
  const [current, setCurrent] = useState<CandidatureEligibilities | null>(null)
  const data = current ?? query.data ?? null

  return (
    <section
      aria-labelledby="eligibilities-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="eligibilities-title" className="font-heading text-lg font-semibold text-foreground">
        Dispositifs (JEIR, JEI, CIR…)
      </h2>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <p className="text-xs text-muted-foreground">
        Informations déclaratives : Confluent ne calcule aucun avantage fiscal et ne vérifie aucune
        condition d’éligibilité.
      </p>
      {data ? (
        <Body
          scope={scope}
          data={data}
          describeSide={describeSide}
          onChange={setCurrent}
          onStale={() => {
            void getEligibilities(scope).then(setCurrent, () => undefined)
          }}
        />
      ) : query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {failure(query.error, 'Les dispositifs n’ont pas pu être chargés.')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
    </section>
  )
}

function Body({
  scope,
  data,
  describeSide,
  onChange,
  onStale,
}: {
  scope: EligibilityScope
  data: CandidatureEligibilities
  describeSide: (side: EligibilitySide) => string
  onChange: (data: CandidatureEligibilities) => void
  onStale: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const isWorkspace = scope.side === 'workspace'

  // Runs a write; a refusal because the eligibility changed meanwhile reloads the list.
  async function act(
    write: () => Promise<CandidatureEligibilities>,
    success: string,
    fallback: string,
  ) {
    setBusy(true)
    try {
      onChange(await write())
      toast.success(success)
      return true
    } catch (err) {
      toast.error(failure(err, fallback))
      const status = (err as Partial<ApiError> | undefined)?.status
      if (status === 409 || status === 404) {
        setEditing(null)
        onStale()
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  function askRemove(e: CandidatureEligibility) {
    setConfirm({
      title: `Retirer l’éligibilité « ${e.scheme.label} » ?`,
      description:
        e.verifiedAt !== null
          ? 'Elle a été vérifiée par la structure : cette vérification sera perdue avec elle.'
          : 'Elle ne figurera plus parmi les dispositifs de cette candidature.',
      confirmLabel: 'Retirer',
      onConfirm: () =>
        void act(
          () => removeEligibility(scope, e.id, e.version),
          'Éligibilité retirée.',
          'L’éligibilité n’a pas été retirée.',
        ),
    })
  }

  const setVerified = (e: CandidatureEligibility, verified: boolean) =>
    act(
      () => updateEligibility(scope, e.id, { version: e.version, verified }),
      verified ? `« ${e.scheme.label} » marquée vérifiée.` : 'Vérification retirée.',
      'La vérification n’a pas été enregistrée.',
    )

  return (
    <>
      {data.eligibilities.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun dispositif indiqué pour l’instant.</p>
      ) : (
        <ul aria-label="Dispositifs indiqués" className="flex flex-col divide-y divide-border">
          {data.eligibilities.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="wrap-anywhere font-medium text-foreground">
                    {e.scheme.label}
                  </span>
                  {e.verifiedAt !== null ? (
                    <Badge>Vérifiée par la structure le {dateFr(e.verifiedAt)}</Badge>
                  ) : (
                    <Badge variant="outline">Déclarée, non vérifiée</Badge>
                  )}
                  {!e.scheme.active && (
                    <Badge variant="outline">Dispositif plus proposé par la structure</Badge>
                  )}
                </div>
                {e.scheme.description && (
                  <p className="wrap-anywhere text-xs text-muted-foreground">
                    {e.scheme.description}
                  </p>
                )}
                {editing === e.id ? (
                  <NoteForm
                    eligibility={e}
                    busy={busy}
                    warnVerification={!isWorkspace && e.verifiedAt !== null}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (note) => {
                      const done = await act(
                        () => updateEligibility(scope, e.id, { version: e.version, note }),
                        'Précision enregistrée.',
                        'La précision n’a pas été enregistrée.',
                      )
                      if (done) setEditing(null)
                    }}
                  />
                ) : (
                  e.note && <p className="mt-1 wrap-anywhere text-sm text-foreground">{e.note}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Indiquée le {dateFr(e.declaredAt)} {describeSide(e.declaredBy)}
                  {e.updatedAt !== e.declaredAt &&
                    ` · modifiée le ${dateFr(e.updatedAt)} ${describeSide(e.updatedBy)}`}
                </p>
              </div>
              {editing !== e.id && (
                <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
                  {isWorkspace && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`${e.verifiedAt !== null ? 'Retirer la vérification de' : 'Marquer vérifiée'} « ${e.scheme.label} »`}
                      onClick={() => void setVerified(e, e.verifiedAt === null)}
                    >
                      {e.verifiedAt !== null ? 'Retirer la vérification' : 'Marquer vérifiée'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Modifier la précision de « ${e.scheme.label} »`}
                    onClick={() => setEditing(e.id)}
                  >
                    Modifier la précision
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Retirer « ${e.scheme.label} »`}
                    onClick={() => askRemove(e)}
                  >
                    Retirer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.schemes.length > 0 ? (
        <Declare
          data={data}
          busy={busy}
          canVerify={isWorkspace}
          onSubmit={(input) =>
            act(
              () => declareEligibility(scope, input),
              'Éligibilité indiquée.',
              'L’éligibilité n’a pas été indiquée.',
            )
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Tous les dispositifs proposés par la structure sont déjà indiqués.
        </p>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function NoteForm({
  eligibility,
  busy,
  warnVerification,
  onCancel,
  onSubmit,
}: {
  eligibility: CandidatureEligibility
  busy: boolean
  warnVerification: boolean
  onCancel: () => void
  onSubmit: (note: string | null) => Promise<void>
}) {
  const ids = { note: useId(), error: useId(), hint: useId() }
  const [note, setNote] = useState(eligibility.note ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = declareEligibilitySchema.shape.note.safeParse(note)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Précision invalide.')
    setError(null)
    await onSubmit(parsed.data ?? null)
  }

  const describedBy = [warnVerification ? ids.hint : null, error ? ids.error : null]
    .filter(Boolean)
    .join(' ')
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={`Précision de « ${eligibility.scheme.label} »`}
      className="mt-2 flex flex-col gap-2"
    >
      <Label htmlFor={ids.note}>Précision (facultatif)</Label>
      <Input
        id={ids.note}
        value={note}
        maxLength={ELIGIBILITY_SCHEME_LIMITS.note}
        autoFocus
        aria-describedby={describedBy || undefined}
        onChange={(e) => {
          setNote(e.target.value)
          setError(null)
        }}
      />
      {warnVerification && (
        <p id={ids.hint} className="text-xs text-muted-foreground">
          La structure a vérifié cette éligibilité : modifier la précision retire cette
          vérification.
        </p>
      )}
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Enregistrer
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

// A new eligibility: a scheme still offered and not indicated yet, an optional note and — the
// workspace's side only — verified at once.
function Declare({
  data,
  busy,
  canVerify,
  onSubmit,
}: {
  data: CandidatureEligibilities
  busy: boolean
  canVerify: boolean
  onSubmit: (input: {
    schemeId: string
    note: string | null
    verified?: boolean
  }) => Promise<boolean>
}) {
  const ids = { scheme: useId(), note: useId(), error: useId(), desc: useId() }
  const [open, setOpen] = useState(false)
  const [schemeId, setSchemeId] = useState('')
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = data.schemes.find((s) => s.id === schemeId)

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
          Indiquer un dispositif
        </Button>
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = declareEligibilitySchema.safeParse({ schemeId, note })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.')
    setError(null)
    const done = await onSubmit({
      schemeId: parsed.data.schemeId,
      note: parsed.data.note ?? null,
      ...(canVerify ? { verified } : {}),
    })
    if (done) {
      setOpen(false)
      setSchemeId('')
      setNote('')
      setVerified(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label="Nouveau dispositif"
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.scheme}>Dispositif</Label>
          <NativeSelect
            id={ids.scheme}
            value={schemeId}
            aria-describedby={
              [chosen?.description ? ids.desc : null, error ? ids.error : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onChange={(e) => {
              setSchemeId(e.target.value)
              setError(null)
            }}
          >
            <option value="">Choisir…</option>
            {data.schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          {chosen?.description && (
            <p id={ids.desc} className="wrap-anywhere text-xs text-muted-foreground">
              {chosen.description}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={ids.note}>Précision (facultatif)</Label>
          <Input
            id={ids.note}
            value={note}
            maxLength={ELIGIBILITY_SCHEME_LIMITS.note}
            placeholder="Par exemple : rescrit obtenu en 2025"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      {canVerify && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          Vérifiée par notre structure
        </label>
      )}
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Indiquer
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  )
}
