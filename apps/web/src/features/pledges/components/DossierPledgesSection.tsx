import { interestIdentityLabel } from '@confluent/shared'
import { formatAmount } from '@/features/dossiers/presentation'
import { useAsync } from '@/lib/useAsync'
import { getDossierPledges } from '../api'

// ROADMAP E07.06, for the owner of a request: how many investors who read it now pledged and their
// total, and for each pledge what its investor chose to show — their name, their amount — nothing
// else (neither intention, comment nor date).
export function DossierPledgesSection({ dossierId }: { dossierId: string }) {
  const query = useAsync(() => getDossierPledges(dossierId), [dossierId])
  const data = query.data
  const hidden = data ? data.count - data.shown.length : 0

  return (
    <section className="mt-8" aria-labelledby="pledges-heading">
      <h2
        id="pledges-heading"
        className="font-heading text-xl font-semibold text-foreground md:text-2xl"
      >
        Promesses
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Les promesses des investisseurs qui lisent cette demande (partage nominatif ou vivier d’une
        structure). Chacun choisit s’il vous montre son nom et son montant ; le total les compte
        toutes. Une promesse est une intention déclarative de financement : elle n’engage ni
        l’investisseur ni vous, et ne vaut ni engagement ferme ni financement obtenu.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
        {query.isLoading && !data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : !data ? (
          <p role="alert" className="text-sm text-destructive">
            Impossible de charger les promesses.
          </p>
        ) : data.count === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune promesse pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">
              {data.count === 1 ? '1 promesse' : `${data.count} promesses`} — total{' '}
              {formatAmount(data.totalEur)}
            </p>
            {data.shown.length > 0 && (
              <ul role="list" aria-label="Promesses montrées" className="flex flex-col gap-1">
                {data.shown.map((line, i) => (
                  <li key={i} className="wrap-anywhere text-sm text-foreground">
                    {line.identity ? interestIdentityLabel(line.identity) : 'Investisseur anonyme'}
                    {' — '}
                    {line.amountEur !== null ? (
                      formatAmount(line.amountEur)
                    ) : (
                      <span className="text-muted-foreground">montant non montré</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {hidden > 0 && (
              <p className="text-sm text-muted-foreground">
                {hidden === 1
                  ? '1 investisseur n’a souhaité montrer ni son nom ni son montant.'
                  : `${hidden} investisseurs n’ont souhaité montrer ni leur nom ni leur montant.`}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
