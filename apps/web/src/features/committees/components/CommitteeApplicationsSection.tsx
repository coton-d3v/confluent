import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  COMMITTEE_APPLICATION_STATUSES,
  COMMITTEE_APPLICATION_STATUS_LABELS,
  COMMITTEE_STATUS_LABELS,
  committeeApplicationTransitionsFor,
  financingOpenToCommittees,
  type Committee,
  type CommitteeApplication,
  type CommitteeApplicationStatus,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { listReceivedCandidatures } from '@/features/candidatures/api'
import { FinancingStatusBadge } from '@/features/candidatures/components/FinancingStatusPanel'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { changeCommitteeApplication, listCommitteeApplications } from '../api'
import { CommitteeApplicationBadge } from './CommitteeApplicationBadge'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const personOf = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email

// The structure's actions, named from where the entry is.
function actionLabel(from: CommitteeApplicationStatus, to: CommitteeApplicationStatus): string {
  if (to === 'accepted') return 'Accepter'
  if (to === 'refused') return 'Refuser'
  if (to === 'proposed') return 'Proposer à nouveau'
  return from === 'proposed' ? 'Retirer la proposition' : 'Retirer du comité'
}

const ORDER = Object.fromEntries(COMMITTEE_APPLICATION_STATUSES.map((s, i) => [s, i]))

// ROADMAP E08.03: the requests applied to, proposed for and retained at a committee, as the
// workspace's conseillers and Confluent's administrators follow them — attach a request the
// workspace received, accept or refuse an application, withdraw; the API decides at each call
// (rules in @confluent/shared), from the version shown.
export function CommitteeApplicationsSection({
  workspaceId,
  committee,
}: {
  workspaceId: string
  committee: Committee
}) {
  const query = useAsync(
    () => listCommitteeApplications(workspaceId, committee.id),
    [workspaceId, committee.id],
  )
  const received = useAsync(() => listReceivedCandidatures(workspaceId), [workspaceId])
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState('')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const open = committee.status === 'planned'
  const entries = [...(query.data ?? [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.createdAt.localeCompare(b.createdAt),
  )
  const linked = new Set(entries.map((e) => e.candidature.id))
  const attachable = (received.data ?? []).filter(
    (c) => !linked.has(c.id) && financingOpenToCommittees(c.financingStatus),
  )

  async function change(
    candidatureId: string,
    to: CommitteeApplicationStatus,
    version: number | null,
    done: string,
  ) {
    setBusy(true)
    try {
      await changeCommitteeApplication(workspaceId, committee.id, { candidatureId, to, version })
      toast.success(done)
      setChosen('')
    } catch (err) {
      const e = err as Partial<ApiError> | undefined
      toast.error(
        e?.status === undefined
          ? 'Rien n’a été changé. Vérifiez votre connexion puis réessayez.'
          : (e.message ?? 'Rien n’a été changé.'),
      )
    } finally {
      setBusy(false)
      query.refetch()
      received.refetch()
    }
  }

  function act(entry: CommitteeApplication, to: CommitteeApplicationStatus) {
    const name = entry.candidature.dossier.name
    const run = () =>
      void change(
        entry.candidature.id,
        to,
        entry.version,
        `« ${name} » : ${COMMITTEE_APPLICATION_STATUS_LABELS[to].toLowerCase()}.`,
      )
    if (to === 'refused' || to === 'withdrawn') {
      setConfirm({
        title: `${actionLabel(entry.status, to)} « ${name} » ?`,
        description:
          to === 'refused'
            ? 'Le porteur verra que sa candidature à ce comité n’est pas retenue ; il ne pourra pas candidater de nouveau à ce comité. Vous pourrez lui proposer ce comité plus tard.'
            : 'Le porteur verra que la structure a retiré sa demande de ce comité. Il pourra candidater de nouveau.',
        confirmLabel: actionLabel(entry.status, to),
        onConfirm: run,
      })
      return
    }
    run()
  }

  return (
    <section
      aria-labelledby="committee-applications-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2
        id="committee-applications-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Demandes rattachées
        {query.data && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({query.data.length})
          </span>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">
        Les demandes que leurs porteurs présentent à ce comité, et celles que la structure y
        rattache. Une demande est retenue quand la structure et son porteur ont tous deux accepté.
        Les porteurs voient où en est leur participation, jamais les autres demandes ; les
        investisseurs ne voient pas cette liste.
      </p>
      {!open && (
        <p role="status" className="text-sm text-foreground">
          Ce comité est « {COMMITTEE_STATUS_LABELS[committee.status]} » : ses participations restent
          telles quelles et ne changent plus tant qu’il n’est pas de nouveau programmé.
        </p>
      )}

      {query.error ? (
        <p role="alert" className="text-sm text-foreground">
          Impossible de charger les demandes rattachées. Réessayez plus tard.
        </p>
      ) : !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune demande rattachée à ce comité.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Demandes rattachées au comité">
          {entries.map((entry) => {
            const targets = open
              ? committeeApplicationTransitionsFor(entry.status, 'workspace')
              : []
            const who = entry.changedBy ? personOf(entry.changedBy) : 'un compte supprimé'
            return (
              <li
                key={entry.id}
                data-testid="committee-application"
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    to={`/workspaces/${workspaceId}/candidatures/${entry.candidature.id}`}
                    className="min-w-0 wrap-anywhere text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {entry.candidature.company.name} — {entry.candidature.dossier.name}
                  </Link>
                  <CommitteeApplicationBadge status={entry.status} />
                  <FinancingStatusBadge status={entry.candidature.financingStatus} />
                </div>
                <p className="wrap-anywhere text-xs text-muted-foreground">
                  {entry.by === 'owner' ? `Par le porteur de projet (${who})` : `Par ${who}`}, le{' '}
                  {dateFr(entry.changedAt)}
                </p>
                {targets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {targets.map((to) => (
                      <Button
                        key={to}
                        type="button"
                        className="h-10 px-3"
                        variant={to === 'accepted' ? 'default' : 'outline'}
                        disabled={busy}
                        onClick={() => act(entry, to)}
                      >
                        {actionLabel(entry.status, to)}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            const candidature = attachable.find((c) => c.id === chosen)
            if (!candidature) return
            void change(
              candidature.id,
              'proposed',
              null,
              `« ${candidature.dossier.name} » est proposée pour ce comité.`,
            )
          }}
        >
          <Label htmlFor="committee-attach">Rattacher une candidature reçue</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <NativeSelect
              id="committee-attach"
              className="h-10 sm:flex-1"
              value={chosen}
              disabled={busy || attachable.length === 0}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">
                {attachable.length === 0
                  ? 'Aucune autre candidature à rattacher'
                  : 'Choisissez une candidature'}
              </option>
              {attachable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company.name} — {c.dossier.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" className="h-10" disabled={busy || chosen === ''}>
              Rattacher
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Le porteur confirme ou décline : la demande n’est retenue qu’une fois confirmée. Seules
            les candidatures envoyées à ce workspace, dont le financement n’est pas clos, sont
            proposées.
          </p>
        </form>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  )
}
