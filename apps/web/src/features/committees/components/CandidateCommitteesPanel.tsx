import { useState } from 'react'
import { toast } from 'sonner'
import {
  committeeApplicationTransitionsFor,
  committeeOpenToCandidates,
  type CandidateCommittee,
  type CommitteeApplicationStatus,
  type OwnerCommitteeApplication,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { changeCandidateApplication, listCandidateCommittees } from '../api'
import { placeLine } from '../format'
import { CommitteeApplicationBadge } from './CommitteeApplicationBadge'
import { CommitteeStatusBadge, CommitteeWhen } from './CommitteeSummary'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

// The entrepreneur's actions, named from where their participation is.
function actionLabel(from: CommitteeApplicationStatus | null, to: CommitteeApplicationStatus) {
  if (to === 'applied') return from === null ? 'Candidater' : 'Candidater à nouveau'
  if (to === 'accepted') return 'Confirmer ma participation'
  if (from === 'proposed') return 'Décliner'
  return from === 'applied' ? 'Retirer ma candidature' : 'Retirer ma demande'
}

function situation(application: OwnerCommitteeApplication | null, workspace: string): string {
  if (!application) return 'Vous n’avez pas candidaté à ce comité.'
  const since = `depuis le ${dateFr(application.changedAt)}`
  switch (application.status) {
    case 'applied':
      return `Votre candidature attend la réponse de ${workspace} (${since}).`
    case 'proposed':
      return `${workspace} propose de présenter votre demande à ce comité : confirmez ou déclinez (${since}).`
    case 'accepted':
      return `Votre demande est retenue pour ce comité (${since}).`
    case 'refused':
      return `${workspace} n’a pas retenu votre candidature à ce comité (${since}).`
    case 'withdrawn':
      return application.by === 'owner'
        ? `Vous avez retiré votre demande de ce comité (${since}).`
        : `${workspace} a retiré votre demande de ce comité (${since}).`
  }
}

// ROADMAP E08.03: the committees of the workspace a candidature was sent to, as its entrepreneur
// reads them — the shared view only (never the internal notes), the link once retained —, with
// their participation: apply, confirm a proposal, decline or withdraw. The API decides at each call
// (rules in @confluent/shared), from the version shown.
export function CandidateCommitteesPanel({
  candidatureId,
  workspaceName,
  // Whatever brings the request to a committee needs it open: financing not closed in the
  // workspace, request not archived.
  canBringRequest,
  closedReason,
}: {
  candidatureId: string
  workspaceName: string
  canBringRequest: boolean
  closedReason: string
}) {
  const query = useAsync(() => listCandidateCommittees(candidatureId), [candidatureId])
  const [current, setCurrent] = useState<CandidateCommittee[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [now] = useState(() => Date.now())
  const committees = current ?? query.data

  async function change(item: CandidateCommittee, to: CommitteeApplicationStatus, done: string) {
    setBusy(true)
    try {
      setCurrent(
        await changeCandidateApplication(candidatureId, item.committee.id, {
          to,
          version: item.application?.version ?? null,
        }),
      )
      toast.success(done)
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'Rien n’a été changé. Vérifiez votre connexion puis réessayez.'
          : (e.message ?? 'Rien n’a été changé.'),
      )
      setCurrent(null)
      query.refetch()
    } finally {
      setBusy(false)
    }
  }

  function act(item: CandidateCommittee, to: CommitteeApplicationStatus) {
    const from = item.application?.status ?? null
    const name = item.committee.name
    if (to === 'withdrawn') {
      setConfirm({
        title: `${actionLabel(from, to)} pour « ${name} » ?`,
        description:
          from === 'proposed'
            ? `${workspaceName} verra que vous déclinez sa proposition. Vous pourrez candidater ensuite tant que le comité n’a pas commencé.`
            : `${workspaceName} verra que vous retirez votre demande de ce comité. Vous pourrez candidater de nouveau tant que le comité n’a pas commencé.`,
        confirmLabel: actionLabel(from, to),
        onConfirm: () => void change(item, to, `Demande retirée de « ${name} ».`),
      })
      return
    }
    void change(
      item,
      to,
      to === 'accepted'
        ? `Participation confirmée à « ${name} ».`
        : `Candidature envoyée pour « ${name} ».`,
    )
  }

  return (
    <section
      aria-labelledby="candidate-committees-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="candidate-committees-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Comités
      </h2>
      <p className="text-sm text-muted-foreground">
        Les comités à venir de {workspaceName}, et ceux auxquels votre demande participe. Vous y
        voyez ce que la structure diffuse aux candidats ; le lien de visioconférence apparaît une
        fois votre participation retenue. Ni les investisseurs, ni les autres porteurs, ni les
        personnes avec qui vous partagez la demande ne voient vos candidatures aux comités.
      </p>
      {!canBringRequest && (
        <p role="status" className="text-sm text-foreground">
          {closedReason}
        </p>
      )}

      {query.error ? (
        <p role="alert" className="text-sm text-foreground">
          Impossible de charger les comités. Réessayez plus tard.
        </p>
      ) : !committees ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : committees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {workspaceName} n’a programmé aucun comité à venir.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={`Comités de ${workspaceName}`}>
          {committees.map((item) => {
            const { committee, application } = item
            const from = application?.status ?? null
            const targets =
              committee.status === 'planned'
                ? committeeApplicationTransitionsFor(from, 'owner').filter(
                    (to) =>
                      to === 'withdrawn' ||
                      (canBringRequest && committeeOpenToCandidates(committee, now)),
                  )
                : []
            return (
              <li
                key={committee.id}
                data-testid="candidate-committee"
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 wrap-anywhere text-base font-medium text-foreground">
                    {committee.name}
                  </p>
                  <CommitteeStatusBadge status={committee.status} />
                  {application && <CommitteeApplicationBadge status={application.status} />}
                </div>
                <CommitteeWhen committee={committee} />
                <p className="wrap-anywhere text-sm text-foreground">{placeLine(committee)}</p>
                {committee.meetingUrl ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Visioconférence : </span>
                    <a
                      href={committee.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-foreground underline underline-offset-4"
                    >
                      {committee.meetingUrl}
                    </a>
                  </p>
                ) : (
                  application?.status !== 'accepted' && (
                    <p className="text-xs text-muted-foreground">
                      Le lien de connexion, s’il y en a un, vous est donné une fois votre
                      participation retenue.
                    </p>
                  )
                )}
                {committee.sharedInfo && (
                  <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
                    {committee.sharedInfo}
                  </p>
                )}
                <p className="wrap-anywhere text-sm text-foreground">
                  {committee.status === 'planned'
                    ? situation(application, workspaceName)
                    : `${situation(application, workspaceName)} Ce comité ne change plus tant qu’il n’est pas de nouveau programmé.`}
                </p>
                {targets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {targets.map((to) => (
                      <Button
                        key={to}
                        type="button"
                        className="h-10 px-3"
                        variant={to === 'withdrawn' ? 'outline' : 'default'}
                        disabled={busy}
                        onClick={() => act(item, to)}
                      >
                        {actionLabel(from, to)}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
