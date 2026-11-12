import { Link, useParams } from 'react-router-dom'
import { ACCESS_LEVEL_LABELS, isArchived } from '@confluent/shared'
import { InterestPanel } from '@/features/interests/components/InterestPanel'
import { getOpportunity } from '@/features/opportunities/api'
import { PledgePanel } from '@/features/pledges/components/PledgePanel'
import { StructureDisclosurePanel } from '@/features/positions/components/StructureDisclosurePanel'
import { sourceLabel } from '@/features/opportunities/presentation'
import { RecipientDossierView } from '@/features/share-access/components/RecipientDossierView'
import { useReadingTracker } from '@/features/reading/useReadingTracker'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// ROADMAP E07.03: one opportunity, as the recipient of a nominative share at its level reads it —
// the same view of the same projection — with the ways it reaches the investor, their mark of
// interest (E07.05), their pledge (E07.06) and their consent to show them to a structure (E07.07).
// Anything they no longer reach (share revoked, publication withdrawn or paused, membership ended) is
// the API's 404.
export default function OpportunityRoute() {
  const { dossierId = '' } = useParams<{ dossierId: string }>()
  const query = useAsync(() => getOpportunity(dossierId), [dossierId])
  const data = query.data
  const status = (query.error as { status?: number } | null)?.status
  // E07.08: measured only through a direct share (`reading` null otherwise).
  useReadingTracker(data?.opportunity.reading?.id)
  const throughShare = data?.opportunity.sources.some((s) => s.kind === 'share') ?? false

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <title>
        {data ? `${data.dossier.name} · Opportunités · Confluent` : 'Opportunité · Confluent'}
      </title>
      <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/opportunites" className="rounded-sm hover:text-foreground">
              Opportunités
            </Link>
          </li>
          {data && (
            <li className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground/60">
                /
              </span>
              <span aria-current="page" className="min-w-0 font-medium text-foreground">
                {data.dossier.name}
              </span>
            </li>
          )}
        </ol>
      </nav>
      {query.isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !data ? (
        <div role="alert" className="flex flex-col gap-3">
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {status === 404 || status === 400
              ? 'Cette opportunité ne vous est pas accessible'
              : 'Impossible de charger cette opportunité'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === 404 || status === 400
              ? 'Le partage a pu être révoqué, la publication retirée du vivier ou mise en pause, ou votre accès à la structure terminé.'
              : 'Vérifiez votre connexion puis réessayez.'}
          </p>
          <Link
            to="/opportunites"
            className="self-start text-sm font-medium text-foreground underline underline-offset-4"
          >
            Revenir à vos opportunités
          </Link>
        </div>
      ) : (
        <>
          <RecipientDossierView view={data} accessLevel={data.opportunity.accessLevel} />
          <InterestPanel
            dossierId={data.dossier.id}
            archived={isArchived(data.dossier)}
            interest={data.opportunity.interest}
            shownAs={data.opportunity.shownAs}
          />
          <PledgePanel
            dossierId={data.dossier.id}
            archived={isArchived(data.dossier)}
            pledge={data.opportunity.pledge}
            shownAs={data.opportunity.shownAs}
          />
          <StructureDisclosurePanel
            dossierId={data.dossier.id}
            structures={data.opportunity.structures}
          />
          <section
            aria-labelledby="provenance-heading"
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <h2 id="provenance-heading" className="text-sm font-medium text-foreground">
              Comment cette demande vous parvient
            </h2>
            <ul role="list" className="flex flex-col gap-1 text-sm text-foreground">
              {data.opportunity.sources.map((s) => (
                <li key={s.kind === 'pool' ? s.workspace.id : 'share'} className="wrap-anywhere">
                  {sourceLabel(s)} — depuis le {dateFr(s.since)}
                </li>
              ))}
            </ul>
            {data.opportunity.sources.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Vous la lisez au niveau le plus large qui vous est accordé : accès{' '}
                {ACCESS_LEVEL_LABELS[data.opportunity.accessLevel].toLowerCase()}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {throughShare
                ? 'Le porteur voit vos consultations de cette demande comme celles de son partage avec vous : leur nombre, leurs dates et le temps pendant lequel la page est affichée au premier plan et utilisée — une mesure approximative, pas une appréciation de votre intérêt.'
                : 'Vos lectures par le vivier ne sont ni chronométrées ni montrées au porteur, pas même en nombre.'}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
