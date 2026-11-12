import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  PARTICIPATION_ADMISSION_LABELS,
  PARTICIPATION_REQUEST_STATUS_LABELS,
  committeeOpenToParticipationRequests,
  participationDecisionNotice,
  type Committee,
  type ParticipationDecision,
  type ParticipationRequest,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { CopyButton } from '@/features/oauth/components/CopyButton'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { decideParticipationRequest, listParticipationRequests, participationFormUrl } from '../api'

const dayFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

const personOf = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email

// What became of the email telling an accepted person (E08.05): the decision stands either way.
function invitationLine(request: ParticipationRequest): string | null {
  if (request.status !== 'accepted' || !request.invitationEmail) return null
  if (request.invitationEmail === 'sent' && request.invitationEmailAt) {
    return `Email d’acceptation envoyé le ${dayFr(request.invitationEmailAt)}.`
  }
  if (request.invitationEmail === 'failed') {
    return 'L’email d’acceptation n’a pas pu partir : la personne peut se connecter avec son adresse depuis la page de connexion de Confluent.'
  }
  return 'Envoi de l’email d’acceptation non confirmé : la personne peut se connecter avec son adresse depuis la page de connexion de Confluent.'
}

// ROADMAP E08.04–E08.05, for the workspace's managers on a committee's page: whether the committee
// is offered on the workspace's public participation form, the form's address, and the requests
// asking for it — to accept or refuse (once, confirmed), then listed with their decision, its author
// and date, and what became of the email. The API decides at each call, from the version shown.
export function ParticipationRequestsSection({
  workspace,
  committee,
  now,
  onChanged,
}: {
  workspace: { id: string; slug: string }
  committee: Committee
  now: number
  // After a decision: for the sections that count participants or list them (code review R70).
  onChanged?: () => void
}) {
  const pending = useAsync(
    () => listParticipationRequests(workspace.id, { committeeId: committee.id }),
    [workspace.id, committee.id],
  )
  const decided = useAsync(
    () => listParticipationRequests(workspace.id, { status: 'decided', committeeId: committee.id }),
    [workspace.id, committee.id],
  )
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const offered = committeeOpenToParticipationRequests(committee, now)
  const url = participationFormUrl(workspace.slug, committee.id)

  async function decide(request: ParticipationRequest, decision: ParticipationDecision) {
    setBusy(true)
    try {
      const result = await decideParticipationRequest(workspace.id, request.id, {
        decision,
        version: request.version,
      })
      const notice = participationDecisionNotice(request.name, decision, result)
      toast[notice.tone](notice.text)
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'Rien n’a été décidé. Vérifiez votre connexion puis réessayez.'
          : (e.message ?? 'Rien n’a été décidé.'),
      )
    } finally {
      setBusy(false)
      // Whatever happened (decided, changed or decided by someone else meanwhile): as it now is.
      pending.refetch()
      decided.refetch()
      onChanged?.()
    }
  }

  function ask(request: ParticipationRequest, decision: ParticipationDecision) {
    const sessions = request.committees.map((c) => `« ${c.name} »`).join(', ')
    setConfirm(
      decision === 'accepted'
        ? {
            title: `Accepter la demande de ${request.name} ?`,
            description:
              `${request.email} rejoindra le workspace comme investisseur — un compte est créé si l’adresse n’en a pas ; une personne déjà membre garde son accès tel quel. ` +
              'Une fois connectée, elle verra ce que le workspace montre à ses investisseurs. ' +
              `Elle sera prévenue par email. La décision vaut pour toutes les sessions demandées (${sessions}) : elle en verra la date, le lieu, le lien et les informations diffusées, jamais les demandes rattachées ni les autres participants, et sera prévenue de leurs changements de date ou annulation. La décision est définitive.`,
            confirmLabel: 'Accepter',
            onConfirm: () => void decide(request, 'accepted'),
          }
        : {
            title: `Refuser la demande de ${request.name} ?`,
            description:
              `La décision vaut pour toutes les sessions demandées (${sessions}) et est définitive. ` +
              'Aucun compte n’est créé et aucun email n’est envoyé ; la personne pourra envoyer une nouvelle demande depuis le formulaire public.',
            confirmLabel: 'Refuser',
            onConfirm: () => void decide(request, 'refused'),
          },
    )
  }

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
          À traiter{pending.data ? ` (${pending.data.length})` : ''}
        </h3>
        <p className="text-xs text-muted-foreground">
          Une demande en attente ne crée aucun compte et n’accorde aucun accès ; personne n’a été
          prévenu par email. Seule une acceptation ajoute la personne au workspace.
        </p>
        {pending.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(pending.error as ApiError).message ?? 'Demandes indisponibles pour le moment.'}
          </p>
        ) : !pending.data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : pending.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande à traiter pour ce comité.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Demandes à traiter">
            {pending.data.map((request) => (
              <RequestItem key={request.id} request={request} committeeId={committee.id}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-10 px-3"
                    disabled={busy}
                    aria-label={`Accepter la demande de ${request.name}`}
                    onClick={() => ask(request, 'accepted')}
                  >
                    Accepter
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    disabled={busy}
                    aria-label={`Refuser la demande de ${request.name}`}
                    onClick={() => ask(request, 'refused')}
                  >
                    Refuser
                  </Button>
                </div>
              </RequestItem>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Traitées{decided.data ? ` (${decided.data.length})` : ''}
        </h3>
        {decided.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(decided.error as ApiError).message ?? 'Demandes indisponibles pour le moment.'}
          </p>
        ) : !decided.data ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : decided.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande traitée pour ce comité.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Demandes traitées">
            {decided.data.map((request) => {
              const invitation = invitationLine(request)
              return (
                <RequestItem key={request.id} request={request} committeeId={committee.id}>
                  <p className="wrap-anywhere text-xs text-muted-foreground">
                    {request.status === 'accepted' ? 'Acceptée' : 'Refusée'}
                    {request.decidedAt && ` le ${dayFr(request.decidedAt)}`} par{' '}
                    {request.decidedBy ? personOf(request.decidedBy) : 'un compte supprimé'}
                    {request.admission && ` · ${PARTICIPATION_ADMISSION_LABELS[request.admission]}`}
                  </p>
                  {invitation && (
                    <p
                      className={
                        request.invitationEmail === 'sent'
                          ? 'text-xs text-muted-foreground'
                          : 'text-xs text-foreground'
                      }
                    >
                      {invitation}
                    </p>
                  )}
                </RequestItem>
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}

function RequestItem({
  request,
  committeeId,
  children,
}: {
  request: ParticipationRequest
  committeeId: string
  children: ReactNode
}) {
  const others = request.committees.filter((c) => c.id !== committeeId)
  return (
    <li
      data-testid="participation-request"
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 wrap-anywhere text-sm font-medium text-foreground">
          {request.name}
          {request.organization && (
            <span className="font-normal text-muted-foreground"> · {request.organization}</span>
          )}
        </p>
        <Badge variant={request.status === 'accepted' ? 'default' : 'outline'}>
          {PARTICIPATION_REQUEST_STATUS_LABELS[request.status]}
        </Badge>
      </div>
      <p className="break-all text-sm text-foreground">{request.email}</p>
      {request.message && (
        <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
          {request.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Reçue le {dayFr(request.createdAt)}
        {request.submissionCount > 1 &&
          ` · envoyée ${request.submissionCount} fois (dernière le ${dayFr(request.lastSubmittedAt)})`}
      </p>
      {others.length > 0 && (
        <p className="wrap-anywhere text-xs text-muted-foreground">
          Demande aussi : {others.map((c) => c.name).join(', ')}
        </p>
      )}
      {children}
    </li>
  )
}
