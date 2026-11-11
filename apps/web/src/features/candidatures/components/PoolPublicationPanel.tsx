import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  POOL_PUBLICATION_BLOCKER_LABELS,
  POOL_PUBLICATION_STATE_LABELS,
  grantsAccess,
  poolPublicationBlocker,
  type AccessLevel,
  type Candidature,
  type PoolPublication,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { ACCESS_LEVEL_DESCRIPTIONS, PUBLIC_IS_NOT_PUBLISHED } from '@/features/shares/levels'
import { previewHref } from '@/features/shares/preview'
import type { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { publishToPool, withdrawFromPool } from '../api'
import { poolPublicationSentence } from '../pool-publication'

// What the pool shows, and what it never shows (@confluent/shared `pool-publication.schema.ts`).
const SCOPE =
  'Ils liront la demande exactement comme un destinataire de lien nominatif au niveau choisi : sa présentation, les réponses du profil, la classification et les documents choisis que ce niveau permet de lire. Jamais vos réponses au formulaire de la structure, le plan de financement, les dispositifs, le parcours, le statut ni les notes de la structure.'

export function PoolPublicationBadge({ publication }: { publication: PoolPublication | null }) {
  if (!publication || publication.state === 'withdrawn') return null
  return (
    <Badge variant={publication.state === 'listed' ? 'secondary' : 'outline'}>
      {POOL_PUBLICATION_STATE_LABELS[publication.state]}
    </Badge>
  )
}

// ROADMAP E07.02, on a sent candidature's page for its owner: publishing the request in the pool of
// that workspace — the requests it presents to its investors — by an explicit consent at a chosen
// level, changing the level, withdrawing it. The API decides at each call (owner only, candidature
// sent, request published, follow-up open); this panel only offers what the shared rule allows.
export function PoolPublicationPanel({
  candidature,
  onChange,
  onStale,
}: {
  candidature: Candidature
  onChange: (next: Candidature) => void
  // A refusal says the screen is out of date: reload the candidature.
  onStale: () => void
}) {
  const { workspace, dossier, poolPublication: publication } = candidature
  const consentId = useId()
  const [level, setLevel] = useState<AccessLevel | null>(null)
  const [consented, setConsented] = useState(false)
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const active = publication !== null && publication.state !== 'withdrawn'
  const current = active ? publication.accessLevel : null
  const blocker = poolPublicationBlocker(
    { publicationStatus: dossier.publicationStatus },
    { submittedAt: candidature.submittedAt, financingStatus: candidature.financingStatus },
  )
  // Narrowing an active publication is always possible; publishing or widening needs no blocker.
  const widening = level !== null && (current === null || grantsAccess(level, current))
  // What stands in the way, told before any level is chosen when nothing is published yet.
  const blocked = blocker !== null && (widening || (!active && level === null))
  const showForm = !active || changing
  const requestPath = `/dashboard/dossiers/view/${encodeURIComponent(dossier.slug)}`

  function reset() {
    setLevel(null)
    setConsented(false)
    setChanging(false)
  }

  async function publish() {
    if (!level || !consented) return
    setBusy(true)
    try {
      onChange(await publishToPool(candidature.id, level))
      toast.success(
        active
          ? `Niveau du vivier de ${workspace.name} : ${ACCESS_LEVEL_LABELS[level].toLowerCase()}.`
          : `Demande publiée dans le vivier de ${workspace.name}.`,
      )
      reset()
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'La publication n’a pas été enregistrée. Vérifiez votre connexion puis réessayez.'
          : (e.message ?? 'La publication n’a pas été enregistrée.'),
      )
      if (e?.status === 409 || e?.status === 404) onStale()
    } finally {
      setBusy(false)
    }
  }

  function askWithdraw() {
    setConfirm({
      title: `Retirer la demande du vivier de ${workspace.name} ?`,
      description: `Les investisseurs de ${workspace.name} ne la liront plus, dès leur prochaine consultation. Les autres structures, vos partages, cette candidature et la publication de la demande ne changent pas. Vous pourrez la publier de nouveau.`,
      confirmLabel: 'Retirer du vivier',
      onConfirm: () => {
        setBusy(true)
        withdrawFromPool(candidature.id).then(
          (next) => {
            onChange(next)
            reset()
            toast.success(`Demande retirée du vivier de ${workspace.name}.`)
            setBusy(false)
          },
          (err: unknown) => {
            const e = err as Partial<ApiError> | undefined
            toast.error(
              e?.status === undefined
                ? 'Le retrait n’a pas été enregistré. Vérifiez votre connexion puis réessayez.'
                : (e.message ?? 'Le retrait n’a pas été enregistré.'),
            )
            setBusy(false)
          },
        )
      },
    })
  }

  return (
    <section
      aria-labelledby="pool-publication-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="pool-publication-title"
          className="wrap-anywhere font-heading text-lg font-semibold text-foreground"
        >
          Vivier de {workspace.name}
        </h2>
        <PoolPublicationBadge publication={publication} />
      </div>
      <p className="text-sm text-muted-foreground">
        Le vivier de {workspace.name} réunit les demandes que la structure présente à ses
        investisseurs. Vous seul décidez d’y publier cette demande, et à quel niveau ; vous pouvez
        l’en retirer à tout moment, sans effet sur les autres structures, vos partages ou cette
        candidature. {SCOPE}
      </p>
      <p className="text-sm text-foreground" aria-live="polite">
        {poolPublicationSentence(publication, {
          side: 'owner',
          financingStatus: candidature.financingStatus,
        })}
      </p>

      {active && !changing && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setChanging(true)}>
            Changer le niveau
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={askWithdraw}>
            Retirer du vivier
          </Button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void publish()
          }}
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          aria-label={
            active ? 'Changer le niveau du vivier' : `Publier dans le vivier de ${workspace.name}`
          }
        >
          <fieldset className="flex flex-col gap-1.5" disabled={busy}>
            <legend className="mb-1 text-sm font-medium text-foreground">
              Ce que liront les investisseurs
            </legend>
            <p className="mb-1 text-xs text-muted-foreground">{PUBLIC_IS_NOT_PUBLISHED}</p>
            {ACCESS_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => {
                  setLevel(l)
                  setConsented(false)
                }}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  level === l
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card hover:border-foreground/40',
                )}
              >
                <span className="block text-sm font-medium">
                  {ACCESS_LEVEL_LABELS[l]}
                  {l === current ? ' (niveau actuel)' : ''}
                </span>
                <span
                  className={cn(
                    'block text-xs',
                    level === l ? 'text-background/70' : 'text-muted-foreground',
                  )}
                >
                  {ACCESS_LEVEL_DESCRIPTIONS[l]}
                </span>
              </button>
            ))}
          </fieldset>
          {level && (
            <Link
              to={previewHref(requestPath, level, candidature.id)}
              className="self-start rounded-sm text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Voir ce que liront les investisseurs
            </Link>
          )}
          {blocker && blocked ? (
            <p role="status" className="text-sm text-foreground">
              {POOL_PUBLICATION_BLOCKER_LABELS[blocker]}
              {blocker === 'request_not_published' && (
                <>
                  {' '}
                  <Link to={`${requestPath}?tab=demande`} className="underline underline-offset-4">
                    Ouvrir l’onglet « Demande »
                  </Link>
                </>
              )}
            </p>
          ) : (
            level &&
            level !== current && (
              <label htmlFor={consentId} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  id={consentId}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-foreground"
                  checked={consented}
                  disabled={busy}
                  onChange={(e) => setConsented(e.target.checked)}
                />
                <span>
                  J’autorise {workspace.name} à présenter cette demande aux investisseurs de son
                  vivier, au niveau « {ACCESS_LEVEL_LABELS[level]} ». Je peux l’en retirer à tout
                  moment.
                </span>
              </label>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                busy || !level || level === current || !consented || (widening && !!blocker)
              }
            >
              {active
                ? 'Enregistrer le niveau'
                : publication
                  ? 'Publier de nouveau dans le vivier'
                  : 'Publier dans le vivier'}
            </Button>
            {changing && (
              <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}

// E07.02, on a received candidature's page for the workspace's conseillers: where the entrepreneur's
// publication in their pool stands — read only, the entrepreneur alone decides it.
export function ReceivedPoolPublication({
  publication,
  financingStatus,
}: {
  publication: PoolPublication | null
  financingStatus: Candidature['financingStatus']
}) {
  return (
    <section
      aria-labelledby="received-pool-title"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="received-pool-title" className="font-heading text-lg font-semibold text-foreground">
          Vivier de votre structure
        </h2>
        <PoolPublicationBadge publication={publication} />
      </div>
      <p className="text-sm text-foreground">
        {poolPublicationSentence(publication, { side: 'workspace', financingStatus })}
      </p>
      <p className="text-sm text-muted-foreground">
        Le vivier réunit les demandes que vous présentez à vos investisseurs ; l’entreprise décide
        seule d’y publier la sienne, à quel niveau, et peut l’en retirer. Vos investisseurs la
        liront comme un destinataire de lien nominatif à ce niveau : jamais ses réponses à votre
        formulaire, le plan de financement, les dispositifs, le parcours, le statut ni vos notes.
      </p>
    </section>
  )
}
