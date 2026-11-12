import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  POOL_PUBLICATION_BLOCKER_LABELS,
  SHOWCASE_CARD_LIMITS,
  SHOWCASE_CARD_STATE_LABELS,
  SHOWCASE_PAUSE_REASON_LABELS,
  SHOWCASE_REGIONS,
  SHOWCASE_REGION_LABELS,
  pseudonymSchema,
  showcaseRegionOf,
  type OwnerShowcaseCard,
  type ReceivedShowcaseCard,
  type ShowcaseCard,
  type ShowcaseRegion,
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
  getReceivedShowcaseCard,
  getShowcaseCard,
  setShowcaseCard,
  withdrawShowcaseCard,
} from '../api'
import { PublicCardView } from './PublicCardView'

// What a card shows, and what it never shows (@confluent/shared `showcase-card.schema.ts`).
const SCOPE =
  'La carte montre à tous : votre pseudonyme, le secteur de la demande, la région que vous choisissez, le montant recherché, le plan de financement de cette candidature en totaux (obtenu, en cours, reste à financer) et son comité (« Prochain comité » une fois la demande retenue, « En attente de comité » sinon). Jamais le nom de l’entreprise, le titre ou la présentation de la demande, vos réponses, documents ou coordonnées, les sources du plan, les promesses, les investisseurs ni les notes de la structure.'

const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function ShowcaseCardBadge({ card }: { card: ShowcaseCard | null }) {
  if (!card || card.state === 'withdrawn') return null
  return (
    <Badge variant={card.state === 'shown' ? 'secondary' : 'outline'}>
      {SHOWCASE_CARD_STATE_LABELS[card.state]}
    </Badge>
  )
}

// Where a card stands, in one sentence, for its owner (`owner`) or the workspace (`workspace`).
function cardSentence(card: ShowcaseCard | null, side: 'owner' | 'workspace'): string {
  if (!card) {
    return side === 'owner'
      ? 'Aucune carte : cette demande n’apparaît pas sur la page publique de la structure.'
      : 'L’entreprise n’a pas consenti à afficher de carte de cette demande sur votre page publique.'
  }
  const since = `depuis le ${dateFr(card.consentedAt)}`
  if (card.state === 'withdrawn') {
    const when = card.withdrawnAt ? ` le ${dateFr(card.withdrawnAt)}` : ''
    return card.withdrawnBecause === 'archived'
      ? `Carte retirée${when} avec l’archivage de la demande.`
      : `Carte retirée${when} par ${side === 'owner' ? 'vous' : 'l’entreprise'}.`
  }
  if (card.state === 'shown') {
    return `Affichée sur la page publique sous le pseudonyme « ${card.pseudonym} », ${since}.`
  }
  const reason = card.pausedBecause
    ? SHOWCASE_PAUSE_REASON_LABELS[card.pausedBecause]
    : 'Elle est masquée pour le moment.'
  return `Consentie sous le pseudonyme « ${card.pseudonym} », ${since}, en pause. ${reason}`
}

// ROADMAP E09.02, on a sent candidature's page for its owner: showing an anonymous card of the request
// on the workspace's public page, under a pseudonym they choose, by an explicit consent; changing
// the pseudonym or the region; withdrawing the card. A preview shows the card exactly as the public
// will read it. The API decides at each call (owner only, candidature sent, request published,
// follow-up open, version read); this panel only offers what the shared rules allow.
export function ShowcaseCardPanel({
  candidatureId,
  workspaceName,
  refreshKey,
}: {
  candidatureId: string
  workspaceName: string
  // Changes when the candidature changes on the page (status, publication): the card is read again.
  refreshKey: string
}) {
  const loaded = useAsync(() => getShowcaseCard(candidatureId), [candidatureId, refreshKey])
  const [saved, setSaved] = useState<OwnerShowcaseCard | null>(null)
  const view = saved ?? loaded.data ?? null
  const pseudonymId = useId()
  const regionId = useId()
  const consentId = useId()
  const errorId = useId()
  const [pseudonym, setPseudonym] = useState('')
  const [region, setRegion] = useState<ShowcaseRegion | null>(null)
  const [consented, setConsented] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  // A fresh reading replaces what this panel last saved.
  useEffect(() => setSaved(null), [loaded.data])

  if (loaded.error && !view) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Carte sur la page publique de {workspaceName}
        </h2>
        <p role="alert" className="text-sm text-foreground">
          La carte n’a pas pu être chargée.
        </p>
        <Button type="button" variant="outline" className="self-start" onClick={loaded.refetch}>
          Réessayer
        </Button>
      </section>
    )
  }
  if (!view) {
    return <p className="text-sm text-muted-foreground">Chargement de la carte publique…</p>
  }

  // A reading that failed while an earlier one is still on screen (code review R72): what follows may
  // be out of date — said so, nothing can be changed from it until a reading succeeds.
  const stale = Boolean(loaded.error)
  const locked = busy || stale
  const { card, blocker, pagePublished } = view
  const active = card !== null && card.state !== 'withdrawn'
  const showForm = !active || editing
  const parsed = pseudonymSchema.safeParse(pseudonym)
  const pseudonymError = parsed.success ? null : (parsed.error.issues[0]?.message ?? null)
  const unchanged =
    active && parsed.success && parsed.data === card.pseudonym && region === card.region
  const pageUrl = `/w/${encodeURIComponent(view.workspace.slug)}`

  function startEditing() {
    setPseudonym(card?.pseudonym ?? '')
    setRegion(card?.region ?? null)
    setConsented(false)
    setTouched(false)
    setEditing(true)
  }

  function reset() {
    setPseudonym('')
    setRegion(null)
    setConsented(false)
    setTouched(false)
    setEditing(false)
  }

  function failed(err: unknown, what: string) {
    const e = err as Partial<ApiError> | undefined
    toast.error(
      e?.status === undefined
        ? `${what} n’a pas été enregistré. Vérifiez votre connexion puis réessayez.`
        : (e.message ?? `${what} n’a pas été enregistré.`),
    )
    // Out of date (changed elsewhere, request or follow-up changed): read the card again, the form
    // closed so that what is shown is what is stored.
    if (e?.status === 409 || e?.status === 404) {
      reset()
      // What this panel saved earlier is out of date too: only a fresh reading is shown.
      setSaved(null)
      loaded.refetch()
    }
  }

  async function submit() {
    setTouched(true)
    if (!parsed.success || !consented || blocker || stale) return
    setBusy(true)
    try {
      const next = await setShowcaseCard(candidatureId, {
        pseudonym: parsed.data,
        region,
        consent: true,
        version: view!.version,
      })
      setSaved(next)
      toast.success(
        next.card?.state === 'shown'
          ? `Carte affichée sur la page publique de ${workspaceName}.`
          : `Consentement enregistré : la carte apparaîtra sur la page publique de ${workspaceName} dès que possible.`,
      )
      reset()
    } catch (err) {
      failed(err, 'Le consentement')
    } finally {
      setBusy(false)
    }
  }

  function askWithdraw() {
    setConfirm({
      title: `Retirer la carte de la page publique de ${workspaceName} ?`,
      description: `La carte disparaîtra de la page publique de ${workspaceName} dès le prochain affichage. Les autres structures, le vivier, vos partages et cette candidature ne changent pas. Vous pourrez l’afficher de nouveau.`,
      confirmLabel: 'Retirer la carte',
      onConfirm: () => {
        setBusy(true)
        withdrawShowcaseCard(candidatureId).then(
          (next) => {
            setSaved(next)
            reset()
            toast.success(`Carte retirée de la page publique de ${workspaceName}.`)
            setBusy(false)
          },
          (err: unknown) => {
            failed(err, 'Le retrait')
            setBusy(false)
          },
        )
      },
    })
  }

  // The card as the public will read it: the API's projection, under the pseudonym and region being
  // typed while the form is open.
  const preview = showForm
    ? {
        ...view.preview,
        pseudonym: parsed.success ? parsed.data : null,
        region,
      }
    : view.preview

  return (
    <section
      aria-labelledby="showcase-card-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="showcase-card-title"
          className="wrap-anywhere font-heading text-lg font-semibold text-foreground"
        >
          Carte sur la page publique de {workspaceName}
        </h2>
        <ShowcaseCardBadge card={card} />
      </div>
      {stale && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground"
        >
          <p>
            L’état actuel de la carte n’a pas pu être relu : ce qui suit peut ne plus être à jour.
            Rien ne peut être modifié avant une relecture réussie.
          </p>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={loaded.isLoading}
            onClick={loaded.refetch}
          >
            {loaded.isLoading ? 'Relecture…' : 'Relire la carte'}
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        La page publique de {workspaceName} peut présenter cette demande sous une carte anonyme, à
        votre seule initiative : vous choisissez le pseudonyme et pouvez retirer la carte à tout
        moment. Ce consentement est distinct du vivier et de vos partages. {SCOPE}
      </p>
      <p className="text-sm text-foreground" aria-live="polite">
        {cardSentence(card, 'owner')}
        {pagePublished && active && (
          <>
            {' '}
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Voir la page publique
            </a>
          </>
        )}
      </p>
      {!pagePublished && !card && (
        <p className="text-sm text-muted-foreground">
          La page publique de {workspaceName} n’est pas publiée : aucune carte n’y est visible pour
          l’instant.
        </p>
      )}

      {active && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={locked} onClick={startEditing}>
            Changer le pseudonyme ou la région
          </Button>
          <Button type="button" variant="ghost" disabled={locked} onClick={askWithdraw}>
            Retirer la carte
          </Button>
        </div>
      )}

      {showForm && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          aria-label={
            active ? 'Modifier la carte' : `Afficher une carte sur la page de ${workspaceName}`
          }
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={pseudonymId}>Pseudonyme (obligatoire)</Label>
            <Input
              id={pseudonymId}
              value={pseudonym}
              maxLength={SHOWCASE_CARD_LIMITS.pseudonym.max * 2}
              autoComplete="off"
              disabled={locked}
              aria-invalid={touched && pseudonymError !== null}
              aria-describedby={`${pseudonymId}-hint${touched && pseudonymError ? ` ${errorId}` : ''}`}
              onChange={(e) => setPseudonym(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <p id={`${pseudonymId}-hint`} className="text-xs text-muted-foreground">
              Le nom sous lequel la demande apparaît, de {SHOWCASE_CARD_LIMITS.pseudonym.min} à{' '}
              {SHOWCASE_CARD_LIMITS.pseudonym.max} caractères : jamais le nom de l’entreprise, le
              titre de la demande, votre nom, une adresse ou un lien.
            </p>
            {touched && pseudonymError && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {pseudonymError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={regionId}>Région affichée</Label>
            <NativeSelect
              id={regionId}
              className="h-11"
              value={region ?? ''}
              disabled={locked}
              onChange={(e) => setRegion(showcaseRegionOf(e.target.value))}
            >
              <option value="">Ne pas indiquer de région</option>
              {SHOWCASE_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {SHOWCASE_REGION_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              La région seulement : jamais une ville, un département ni une adresse.
            </p>
          </div>

          {blocker ? (
            <p role="status" className="text-sm text-foreground">
              {POOL_PUBLICATION_BLOCKER_LABELS[blocker]}
            </p>
          ) : (
            <label htmlFor={consentId} className="flex items-start gap-2 text-sm text-foreground">
              <input
                id={consentId}
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-foreground"
                checked={consented}
                disabled={locked}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>
                J’autorise {workspaceName} à afficher cette carte, telle que présentée ci-dessous,
                sur sa page publique, visible par tous. Je peux la retirer à tout moment.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="h-11"
              disabled={locked || !consented || !!blocker || unchanged || !parsed.success}
            >
              {active ? 'Enregistrer la carte' : card ? 'Afficher de nouveau' : 'Afficher la carte'}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                disabled={locked}
                onClick={reset}
              >
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Aperçu : la carte telle que le public la lira
        </h3>
        <PublicCardView card={preview} headingLevel={4} />
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Le plan et le comité sont ceux de cette candidature, au moment de l’affichage.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loaded.isLoading}
            onClick={loaded.refetch}
          >
            Actualiser l’aperçu
          </Button>
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}

// E09.02, on a received candidature's page for the workspace's conseillers: where the entrepreneur's
// card on the public page stands — read only, the entrepreneur alone decides it.
export function ReceivedShowcaseCard({
  workspaceId,
  candidatureId,
}: {
  workspaceId: string
  candidatureId: string
}) {
  const loaded = useAsync(
    () => getReceivedShowcaseCard(workspaceId, candidatureId),
    [workspaceId, candidatureId],
  )
  const data: ReceivedShowcaseCard | undefined = loaded.data
  return (
    <section
      aria-labelledby="received-showcase-title"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="received-showcase-title"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Carte sur votre page publique
        </h2>
        {data && <ShowcaseCardBadge card={data.card} />}
      </div>
      {loaded.error ? (
        <p role="alert" className="text-sm text-foreground">
          La carte n’a pas pu être chargée.{' '}
          <button type="button" className="underline underline-offset-4" onClick={loaded.refetch}>
            Réessayer
          </button>
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <p className="text-sm text-foreground">{cardSentence(data.card, 'workspace')}</p>
      )}
      <p className="text-sm text-muted-foreground">
        L’entreprise décide seule d’afficher une carte anonyme de cette demande sur votre page
        publique, sous un pseudonyme qu’elle choisit, et peut la retirer. La carte montre le
        secteur, la région choisie, le montant recherché, les totaux du plan (obtenu, en cours,
        reste à financer) et le prochain comité qui a retenu la demande ; jamais le nom de
        l’entreprise, ses réponses, ses documents, les sources du plan, les promesses ni vos notes.
      </p>
    </section>
  )
}
