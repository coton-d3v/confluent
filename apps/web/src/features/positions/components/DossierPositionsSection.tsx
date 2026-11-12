import { interestIdentityLabel } from '@confluent/shared'
import { formatAmount } from '@/features/dossiers/presentation'
import { useAsync } from '@/lib/useAsync'
import { getDossierPositions } from '../api'
import { readFailure } from '@/lib/read-failure'
import { LoadError } from '@/components/confluent/LoadError'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

// ROADMAP E07.07, for the owner of a request: in one view, what E07.05 and E07.06 open to them — how
// many investors who read it now marked their interest or pledged, the pledges' total, and for each
// investor only what they chose to show. A mark and a pledge share a line only when both show the
// name; an amount shown without a name stays anonymous.
export function DossierPositionsSection({ dossierId }: { dossierId: string }) {
  const query = useAsync(() => getDossierPositions(dossierId), [dossierId])
  const data = query.data
  const namedInterests = data ? data.named.filter((n) => n.interest).length : 0
  const namedPledges = data ? data.named.filter((n) => n.pledge).length : 0
  const unnamedInterests = data ? data.interests.count - namedInterests : 0
  const hiddenPledges = data ? data.pledges.count - namedPledges - data.anonymousAmounts.length : 0

  return (
    <section className="mt-8" aria-labelledby="positions-heading">
      <h2
        id="positions-heading"
        className="font-heading text-xl font-semibold text-foreground md:text-2xl"
      >
        Positionnements des investisseurs
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Les marques d’intérêt et les promesses des investisseurs qui lisent cette demande (partage
        nominatif ou vivier d’une structure). Les nombres et le total les comptent toutes ; un nom
        ou un montant n’apparaît que si l’investisseur a choisi de vous le montrer. Une marque
        d’intérêt n’engage à rien ; une promesse est une intention déclarative de financement : elle
        n’engage ni l’investisseur ni vous, et ne vaut ni engagement ferme ni financement obtenu.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
        {query.isLoading && !data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : !data ? (
          <LoadError
            message={readFailure(query.error, 'Les positionnements n’ont pas pu être chargés.')}
            onRetry={query.refetch}
          />
        ) : data.interests.count === 0 && data.pledges.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune marque d’intérêt ni promesse pour le moment.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Marques d’intérêt</dt>
                <dd className="text-base font-medium text-foreground">{data.interests.count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Promesses</dt>
                <dd className="text-base font-medium text-foreground">{data.pledges.count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total des promesses</dt>
                <dd className="text-base font-medium text-foreground">
                  {formatAmount(data.pledges.totalEur)}
                </dd>
              </div>
            </dl>
            {data.named.length > 0 && (
              <ul role="list" aria-label="Investisseurs nommés" className="flex flex-col gap-2">
                {data.named.map((n, i) => (
                  <li key={i} className="flex flex-col gap-0.5 text-sm">
                    <span className="wrap-anywhere font-medium text-foreground">
                      {interestIdentityLabel(n.identity)}
                    </span>
                    <span className="wrap-anywhere text-muted-foreground">
                      {[
                        n.interest ? `intérêt marqué le ${dateFr(n.interest.markedAt)}` : null,
                        n.pledge
                          ? n.pledge.amountEur !== null
                            ? `promesse de ${formatAmount(n.pledge.amountEur)}`
                            : 'promesse, montant non montré'
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.anonymousAmounts.length > 0 && (
              <p className="wrap-anywhere text-sm text-foreground">
                Promesses sans nom : {data.anonymousAmounts.map((a) => formatAmount(a)).join(', ')}
              </p>
            )}
            {(unnamedInterests > 0 || hiddenPledges > 0) && (
              <ul role="list" className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                {unnamedInterests > 0 && (
                  <li>
                    {plural(
                      unnamedInterests,
                      'marque d’intérêt sans nom.',
                      'marques d’intérêt sans nom.',
                    )}
                  </li>
                )}
                {hiddenPledges > 0 && (
                  <li>
                    {plural(
                      hiddenPledges,
                      'promesse sans nom ni montant, comptée dans le total.',
                      'promesses sans nom ni montant, comptées dans le total.',
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
