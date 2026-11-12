import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ENTREPRENEUR_ACCESS_ADMISSION_LABELS,
  ENTREPRENEUR_ACCESS_REQUEST_STATUS_LABELS,
  entrepreneurAccessDecisionNotice,
  type EntrepreneurAccessDecision,
  type EntrepreneurAccessRequest,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { CopyButton } from '@/features/oauth/components/CopyButton'
import type { ApiError } from '@/lib/api-client'
import {
  decideEntrepreneurAccessRequest,
  entrepreneurAccessFormPath,
  listEntrepreneurAccessRequests,
} from '../api'

const dayFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

const personOf = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email

// What became of the invitation email (the decision stands either way).
function invitationLine(request: EntrepreneurAccessRequest): string | null {
  if (request.status !== 'accepted' || !request.invitationEmail) return null
  if (request.invitationEmail === 'sent' && request.invitationEmailAt) {
    return `Email d’invitation envoyé le ${dayFr(request.invitationEmailAt)}.`
  }
  if (request.invitationEmail === 'failed') {
    return 'L’email d’invitation n’a pas pu partir : la personne peut se connecter avec son adresse depuis la page de connexion de Confluent.'
  }
  return 'Envoi de l’email d’invitation non confirmé : la personne peut se connecter avec son adresse depuis la page de connexion de Confluent.'
}

type Lists = { pending: EntrepreneurAccessRequest[]; decided: EntrepreneurAccessRequest[] }

// ROADMAP E09.05, for the workspace's managers: the requests for access to its candidature path sent
// from its public page by entrepreneurs without an account — to accept or refuse (once, confirmed),
// then listed with their decision, its author and date, what the acceptance did of the account and
// what became of the email. The API decides at each call, from the version shown. After a refused
// decision (changed or decided meanwhile) the lists are read again; while that re-read fails, the
// failure stays on screen with a retry and no decision can be taken (code review R71/R72).
export function EntrepreneurAccessRequestsSection({
  workspace,
}: {
  workspace: { id: string; slug: string; name: string }
}) {
  const [lists, setLists] = useState<Lists | null>(null)
  const [readFailure, setReadFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const url = new URL(entrepreneurAccessFormPath(workspace.slug), window.location.origin).toString()

  // True once both lists are read as they now are.
  const read = useCallback(async (): Promise<boolean> => {
    try {
      const [pending, decided] = await Promise.all([
        listEntrepreneurAccessRequests(workspace.id),
        listEntrepreneurAccessRequests(workspace.id, { status: 'decided' }),
      ])
      setLists({ pending, decided })
      setReadFailure(null)
      return true
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      setReadFailure(
        e?.status === undefined
          ? 'Les demandes n’ont pas pu être lues : vérifiez votre connexion, puis réessayez.'
          : (e.message ?? 'Les demandes n’ont pas pu être lues.'),
      )
      return false
    }
  }, [workspace.id])

  useEffect(() => {
    void read()
  }, [read])

  async function decide(request: EntrepreneurAccessRequest, decision: EntrepreneurAccessDecision) {
    setBusy(true)
    try {
      const result = await decideEntrepreneurAccessRequest(workspace.id, request.id, {
        decision,
        version: request.version,
      })
      const notice = entrepreneurAccessDecisionNotice(request.name, decision, result)
      toast[notice.tone](notice.text)
      await read()
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'La décision n’a pas pu être confirmée : vérifiez votre connexion. Les demandes sont relues avant toute nouvelle décision.'
          : (e.message ?? 'Rien n’a été décidé.'),
      )
      // Changed, decided by someone else, or not confirmed: read again before anything else.
      if (await read()) toast.info('Les demandes ont été relues : vérifiez-les avant de décider.')
    } finally {
      setBusy(false)
    }
  }

  function ask(request: EntrepreneurAccessRequest, decision: EntrepreneurAccessDecision) {
    setConfirm(
      decision === 'accepted'
        ? {
            title: `Accepter la demande de ${request.name} ?`,
            description:
              `Un compte de porteur de projet est ouvert à l’adresse ${request.email} si elle n’en a pas ; un compte existant n’est pas modifié (un compte qui ne peut pas présenter de demande de financement ne peut pas être accepté). ` +
              `Rien n’est créé à la place de la personne : elle est invitée par email à se connecter puis à présenter sa demande de financement à ${workspace.name}, qui la recevra comme toute candidature. ` +
              'Elle ne devient pas membre du workspace. La décision est définitive.',
            confirmLabel: 'Accepter',
            onConfirm: () => void decide(request, 'accepted'),
          }
        : {
            title: `Refuser la demande de ${request.name} ?`,
            description:
              'Aucun compte n’est créé et aucun email n’est envoyé ; la personne pourra envoyer une nouvelle demande depuis la page publique. La décision est définitive.',
            confirmLabel: 'Refuser',
            onConfirm: () => void decide(request, 'refused'),
          },
    )
  }

  const blocked = busy || readFailure !== null
  return (
    <section
      aria-labelledby="access-requests-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="access-requests-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Demandes d’accès des porteurs de projet
      </h2>
      <p className="text-sm text-foreground">
        Des porteurs de projet sans compte Confluent demandent, depuis la page publique du
        workspace, à rejoindre son parcours de candidature. Le formulaire n’est proposé que tant
        que la page est publiée, que son bloc « Appel à candidater » est affiché et qu’un formulaire
        de candidature est publié.
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Adresse du formulaire</p>
        <div className="flex min-w-0 items-center gap-2">
          <code
            data-testid="access-form-url"
            className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-foreground"
          >
            {url}
          </code>
          <CopyButton text={url} label="Copier l’adresse du formulaire de demande d’accès" />
        </div>
      </div>

      {readFailure && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 p-3"
        >
          <p className="text-sm text-destructive">
            {readFailure} Aucune décision n’est possible tant que les demandes n’ont pas été
            relues.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={busy}
            onClick={() => void read()}
          >
            Réessayer
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          À traiter{lists ? ` (${lists.pending.length})` : ''}
        </h3>
        <p className="text-xs text-muted-foreground">
          Une demande en attente ne crée aucun compte et n’accorde aucun accès ; personne n’a été
          prévenu par email.
        </p>
        {!lists ? (
          !readFailure && <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : lists.pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande à traiter.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Demandes d’accès à traiter">
            {lists.pending.map((request) => (
              <RequestItem key={request.id} request={request}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-10 px-3"
                    disabled={blocked}
                    aria-label={`Accepter la demande de ${request.name}`}
                    onClick={() => ask(request, 'accepted')}
                  >
                    Accepter
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    disabled={blocked}
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
          Traitées{lists ? ` (${lists.decided.length})` : ''}
        </h3>
        {!lists ? null : lists.decided.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande traitée.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Demandes d’accès traitées">
            {lists.decided.map((request) => {
              const invitation = invitationLine(request)
              return (
                <RequestItem key={request.id} request={request}>
                  <p className="wrap-anywhere text-xs text-muted-foreground">
                    {request.status === 'accepted' ? 'Acceptée' : 'Refusée'}
                    {request.decidedAt && ` le ${dayFr(request.decidedAt)}`} par{' '}
                    {request.decidedBy ? personOf(request.decidedBy) : 'un compte supprimé'}
                    {request.admission &&
                      ` · ${ENTREPRENEUR_ACCESS_ADMISSION_LABELS[request.admission]}`}
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
  children,
}: {
  request: EntrepreneurAccessRequest
  children: ReactNode
}) {
  return (
    <li
      data-testid="access-request"
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 wrap-anywhere text-sm font-medium text-foreground">
          {request.name}
          <span className="font-normal text-muted-foreground"> · {request.companyName}</span>
        </p>
        <Badge variant={request.status === 'accepted' ? 'default' : 'outline'}>
          {ENTREPRENEUR_ACCESS_REQUEST_STATUS_LABELS[request.status]}
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
      {children}
    </li>
  )
}
