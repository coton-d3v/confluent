import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  SHOWCASE_PAUSE_REASON_LABELS,
  SHOWCASE_REGION_LABELS,
  type ManagedShowcaseCard,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { listManagedShowcaseCards, setShowcaseCardHidden } from '../api'

const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function stateOf(card: ManagedShowcaseCard): { badge: string; sentence: string } {
  if (card.hiddenAt) {
    return {
      badge: 'Masquée',
      sentence: `Masquée par la structure depuis le ${dateFr(card.hiddenAt)} : absente de la page publique.`,
    }
  }
  if (card.state === 'shown')
    return { badge: 'Affichée', sentence: 'Affichée sur la page publique.' }
  return {
    badge: 'En pause',
    sentence: card.pausedBecause
      ? SHOWCASE_PAUSE_REASON_LABELS[card.pausedBecause]
      : 'Absente de la page publique pour le moment.',
  }
}

// ROADMAP E09.03, in the managers' « Page publique » tab: the cards the workspace's candidates
// consented to show on its page — shown, paused or hidden —, each hidden from the page or restored by
// one click, never changed. The entrepreneur keeps deciding the card itself and may withdraw it. The
// API decides at each call (managers only, a card not withdrawn); `refreshKey` reads the list again
// after the page's settings change, `onChanged` reads the page's preview again after a change here.
export function ShowcaseCardModeration({
  workspaceId,
  refreshKey,
  onChanged,
}: {
  workspaceId: string
  refreshKey: number
  onChanged: () => Promise<void>
}) {
  const loaded = useAsync(() => listManagedShowcaseCards(workspaceId), [workspaceId, refreshKey])
  // The list as last changed here, until it is read again.
  const [changed, setChanged] = useState<{ key: number; cards: ManagedShowcaseCard[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const cards =
    changed && changed.key === refreshKey && !loaded.isLoading ? changed.cards : loaded.data
  // A reading that failed while an earlier list is still on screen (code review R73, as R71/R72):
  // said so durably, with a retry, and no card changed from it until a reading succeeds.
  const stale = Boolean(loaded.error) && cards !== undefined

  async function toggle(card: ManagedShowcaseCard) {
    if (stale) return
    const hide = card.hiddenAt === null
    setBusy(card.candidatureId)
    setFailure(null)
    try {
      const saved = await setShowcaseCardHidden(workspaceId, card.candidatureId, hide)
      setChanged({
        key: refreshKey,
        cards: (cards ?? []).map((c) => (c.candidatureId === saved.candidatureId ? saved : c)),
      })
      toast.success(hide ? 'Carte masquée de la page publique.' : 'Carte rétablie.')
      try {
        await onChanged()
      } catch {
        setFailure(
          'L’aperçu de la page n’a pas pu être relu : rechargez la page pour le voir à jour.',
        )
      }
    } catch (err) {
      const apiError = err as ApiError
      if (apiError?.status === 404) {
        // Withdrawn by the entrepreneur meanwhile: nothing left to hide or restore.
        // Read again; whether that worked is shown by the list itself (or its « non relue » alert).
        setChanged(null)
        loaded.refetch()
        setFailure('Cette carte a été retirée par l’entreprise entre-temps.')
      } else {
        setFailure(apiError?.message ?? 'Action impossible. Réessayez plus tard.')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="ws-page-cards-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="ws-page-cards-title" className="font-heading text-lg font-semibold text-foreground">
          Cartes des projets
        </h2>
        <p className="text-xs text-muted-foreground">
          Les cartes anonymes que les entreprises ont choisi d’afficher sur votre page publique.
          Masquer une carte la retire de la page sans la modifier ; l’entreprise la voit « masquée
          par la structure » et peut toujours la retirer. Rétablir la remet en place.
        </p>
      </div>
      <div aria-live="assertive">
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
      </div>
      {stale && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground"
        >
          <p>
            La liste des cartes n’a pas pu être relue : ce qui suit peut ne plus être à jour. Aucune
            carte ne peut être masquée ou rétablie avant une relecture réussie.
          </p>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={loaded.isLoading}
            onClick={loaded.refetch}
          >
            {loaded.isLoading ? 'Relecture…' : 'Relire la liste'}
          </Button>
        </div>
      )}
      {loaded.error && !cards ? (
        <p role="alert" className="text-sm text-foreground">
          Les cartes n’ont pas pu être chargées.{' '}
          <button type="button" className="underline underline-offset-4" onClick={loaded.refetch}>
            Réessayer
          </button>
        </p>
      ) : !cards ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune carte : aucune entreprise n’a choisi d’afficher une carte sur votre page.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => {
            const { badge, sentence } = stateOf(card)
            return (
              <li
                key={card.candidatureId}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="wrap-anywhere font-medium text-foreground">
                      {card.pseudonym}
                    </span>
                    <Badge variant={card.state === 'shown' ? 'secondary' : 'outline'}>
                      {badge}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {card.region ? `${SHOWCASE_REGION_LABELS[card.region]} · ` : ''}
                    Consentie le {dateFr(card.consentedAt)}. {sentence}
                  </p>
                  <Link
                    to={`/workspaces/${workspaceId}/candidatures/${card.candidatureId}`}
                    className="self-start text-foreground underline underline-offset-4 hover:no-underline"
                  >
                    Ouvrir la candidature
                  </Link>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 self-start"
                  disabled={busy !== null || stale}
                  aria-label={`${card.hiddenAt ? 'Rétablir' : 'Masquer'} la carte « ${card.pseudonym} »`}
                  onClick={() => void toggle(card)}
                >
                  {busy === card.candidatureId
                    ? 'Enregistrement…'
                    : card.hiddenAt
                      ? 'Rétablir sur la page'
                      : 'Masquer de la page'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
