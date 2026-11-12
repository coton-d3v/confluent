import {
  committeeOpenToParticipationRequests,
  type Committee,
  type ParticipationRequest,
} from '@confluent/shared'
import { CopyButton } from '@/features/oauth/components/CopyButton'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { listParticipationRequests, participationFormUrl } from '../api'

const receivedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

// ROADMAP E08.04, for the workspace's managers on a committee's page: whether the committee is
// offered on the workspace's public participation form, the form's address, and the pending
// requests asking for it — read-only: deciding them comes with E08.05, and none grants anything.
export function ParticipationRequestsSection({
  workspace,
  committee,
  now,
}: {
  workspace: { id: string; slug: string }
  committee: Committee
  now: number
}) {
  const query = useAsync(() => listParticipationRequests(workspace.id), [workspace.id])
  const offered = committeeOpenToParticipationRequests(committee, now)
  const url = participationFormUrl(workspace.slug, committee.id)
  const requests = (query.data ?? []).filter((r) => r.committees.some((c) => c.id === committee.id))

  return (
    <section
      aria-labelledby="committee-participation-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="committee-participation-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Demandes de participation
      </h2>
      <p className="text-sm text-foreground">
        {offered
          ? 'Ce comité est proposé sur le formulaire public du workspace : investisseurs et invités peuvent demander à y participer. Le public n’en voit que le nom, la date et l’heure.'
          : committee.participationRequestsOpen
            ? 'Ce comité est ouvert aux demandes, mais n’est plus proposé sur le formulaire public : il est annulé, tenu ou déjà commencé.'
            : 'Ce comité n’est pas proposé sur le formulaire public. Modifiez-le et cochez « Ouvert aux demandes de participation » pour le proposer.'}
      </p>
      {offered && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Adresse du formulaire (cette session y est présélectionnée)
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <code
              data-testid="participation-form-url"
              className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-foreground"
            >
              {url}
            </code>
            <CopyButton text={url} label="Copier l’adresse du formulaire" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          En attente{query.data ? ` (${requests.length})` : ''}
        </h3>
        <p className="text-xs text-muted-foreground">
          Lecture seule pour l’instant : l’acceptation ou le refus arrive prochainement. Une demande
          ne crée aucun compte et n’accorde aucun accès ; personne n’a été prévenu par email.
        </p>
        {query.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(query.error as ApiError).message ?? 'Demandes indisponibles pour le moment.'}
          </p>
        ) : !query.data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande en attente pour ce comité.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => (
              <RequestItem key={request.id} request={request} committeeId={committee.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function RequestItem({
  request,
  committeeId,
}: {
  request: ParticipationRequest
  committeeId: string
}) {
  const others = request.committees.filter((c) => c.id !== committeeId)
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-3">
      <p className="wrap-anywhere text-sm font-medium text-foreground">
        {request.name}
        {request.organization && (
          <span className="font-normal text-muted-foreground"> · {request.organization}</span>
        )}
      </p>
      <p className="break-all text-sm text-foreground">{request.email}</p>
      {request.message && (
        <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
          {request.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Reçue le {receivedOn(request.createdAt)}
        {request.submissionCount > 1 &&
          ` · envoyée ${request.submissionCount} fois (dernière le ${receivedOn(request.lastSubmittedAt)})`}
      </p>
      {others.length > 0 && (
        <p className="wrap-anywhere text-xs text-muted-foreground">
          Demande aussi : {others.map((c) => c.name).join(', ')}
        </p>
      )}
    </li>
  )
}
