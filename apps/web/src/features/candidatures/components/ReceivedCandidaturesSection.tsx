import { Link } from 'react-router-dom'
import { formatAmount, financingTypeLabels } from '@/features/dossiers/presentation'
import { useAsync } from '@/lib/useAsync'
import { listReceivedCandidatures } from '../api'
import { FinancingStatusBadge } from './FinancingStatusPanel'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// ROADMAP E05.09, on a workspace's page for its conseillers (and Confluent's administrators): the
// candidatures sent to the workspace. The API checks the right at each request.
export function ReceivedCandidaturesSection({ workspaceId }: { workspaceId: string }) {
  const query = useAsync(() => listReceivedCandidatures(workspaceId), [workspaceId])
  return (
    <section aria-labelledby="received-title" className="flex flex-col gap-3">
      <div>
        <h2 id="received-title" className="font-heading text-lg font-semibold text-foreground">
          Candidatures reçues
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les demandes de financement que des entreprises présentent à votre structure : leur
          profil commun, leurs réponses à votre formulaire et leur statut de financement chez vous.
          Une candidature en brouillon reste invisible tant que l’entreprise ne l’a pas envoyée.
        </p>
      </div>
      {query.isLoading && !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les candidatures. Réessayez plus tard.
        </p>
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune candidature reçue pour l’instant.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {(query.data ?? []).map((c) => {
            const amount = formatAmount(c.dossier.amountEur)
            const types = financingTypeLabels(c.dossier.financingTypes)
            return (
              <li key={c.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={`/workspaces/${workspaceId}/candidatures/${c.id}`}
                    className="min-w-0 break-words text-base font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {c.company.name} — {c.dossier.name}
                  </Link>
                  <FinancingStatusBadge status={c.financingStatus} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                  {[`Reçue le ${dateFr(c.submittedAt)}`, amount, types.join(', ') || null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
