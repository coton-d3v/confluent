import { Link } from 'react-router-dom'
import { PLEDGE_INTENTION_LABELS, interestIdentityLabel } from '@confluent/shared'
import { formatAmount } from '@/features/dossiers/presentation'
import { useAsync } from '@/lib/useAsync'
import { getWorkspacePositions } from '../api'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// ROADMAP E07.07, on a workspace's page for its conseillers (and Confluent's administrators): the
// requests listed in its pool now, with the positions of the investors who chose to show them to the
// structure — nothing of the others, not even how many. The API checks the right and the consents
// at each request.
export function WorkspacePositionsSection({ workspaceId }: { workspaceId: string }) {
  const query = useAsync(() => getWorkspacePositions(workspaceId), [workspaceId])
  const data = query.data

  return (
    <section aria-labelledby="ws-positions-title" className="flex flex-col gap-3">
      <div>
        <h2 id="ws-positions-title" className="font-heading text-lg font-semibold text-foreground">
          Positionnements des investisseurs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les demandes publiées dans votre vivier, avec les marques d’intérêt et les promesses des
          investisseurs qui ont choisi de vous les montrer. Les autres investisseurs n’apparaissent
          pas, même en nombre. Une promesse est une intention déclarative de financement, jamais un
          engagement ferme ni un financement obtenu.
        </p>
      </div>
      {query.isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !data ? (
        <p role="alert" className="text-sm text-destructive">
          Impossible de charger les positionnements.
        </p>
      ) : data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune demande n’est publiée dans votre vivier pour le moment.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {data.items.map((item) => (
            <li
              key={item.candidatureId}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link
                  to={`/workspaces/${workspaceId}/candidatures/${item.candidatureId}`}
                  className="min-w-0 wrap-anywhere text-base font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {item.company.name} — {item.dossier.name}
                </Link>
                {item.investors.length > 0 && (
                  <span className="text-sm text-foreground">
                    {item.investors.length === 1
                      ? '1 investisseur'
                      : `${item.investors.length} investisseurs`}
                    {item.pledgedEur > 0 && ` · ${formatAmount(item.pledgedEur)} promis`}
                  </span>
                )}
              </div>
              {item.investors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun investisseur ne vous montre son positionnement sur cette demande.
                </p>
              ) : (
                <ul
                  role="list"
                  aria-label={`Positionnements sur ${item.dossier.name}`}
                  className="flex flex-col divide-y divide-border"
                >
                  {item.investors.map((inv, i) => (
                    <li key={i} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
                      <span className="wrap-anywhere font-medium text-foreground">
                        {interestIdentityLabel(inv.identity)}
                      </span>
                      <span className="wrap-anywhere text-muted-foreground">
                        {[
                          inv.interest
                            ? `intérêt marqué le ${dateFr(inv.interest.markedAt)}`
                            : null,
                          inv.pledge
                            ? `promesse de ${formatAmount(inv.pledge.amountEur)} (intention : ${PLEDGE_INTENTION_LABELS[inv.pledge.intention].toLowerCase()}, le ${dateFr(inv.pledge.updatedAt)})`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
