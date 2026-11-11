import { interestIdentityLabel } from '@confluent/shared'
import { useAsync } from '@/lib/useAsync'
import { getDossierInterests } from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// ROADMAP E07.05, for the owner of a request (D05): how many investors who read it now marked their
// interest, and the names of those who chose to show theirs — nothing about the others.
export function DossierInterestsSection({ dossierId }: { dossierId: string }) {
  const query = useAsync(() => getDossierInterests(dossierId), [dossierId])
  const data = query.data
  const unnamed = data ? data.count - data.named.length : 0

  return (
    <section className="mt-8" aria-labelledby="interests-heading">
      <h2
        id="interests-heading"
        className="font-heading text-xl font-semibold text-foreground md:text-2xl"
      >
        Marques d’intérêt
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Les investisseurs qui lisent cette demande (partage nominatif ou vivier d’une structure) et y
        ont marqué leur intérêt. Un nom n’apparaît que si l’investisseur a choisi de le montrer. Une
        marque d’intérêt n’est pas un engagement de financement.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
        {query.isLoading && !data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : !data ? (
          <p role="alert" className="text-sm text-destructive">
            Impossible de charger les marques d’intérêt.
          </p>
        ) : data.count === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune marque d’intérêt pour le moment.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">
              {data.count === 1
                ? '1 investisseur intéressé'
                : `${data.count} investisseurs intéressés`}
            </p>
            {data.named.length > 0 && (
              <ul role="list" aria-label="Investisseurs nommés" className="flex flex-col gap-1">
                {data.named.map((n, i) => (
                  <li key={i} className="wrap-anywhere text-sm text-foreground">
                    {interestIdentityLabel(n)}{' '}
                    <span className="text-muted-foreground">— le {dateFr(n.markedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {unnamed > 0 && (
              <p className="text-sm text-muted-foreground">
                {unnamed === 1
                  ? '1 investisseur n’a pas souhaité montrer son nom.'
                  : `${unnamed} investisseurs n’ont pas souhaité montrer leur nom.`}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
