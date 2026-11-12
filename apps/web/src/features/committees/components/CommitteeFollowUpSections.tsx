import {
  COMMITTEE_NOTICE_KIND_LABELS,
  COMMITTEE_NOTICE_STATE_LABELS,
  type Committee,
  type CommitteeNotice,
  type CommitteeNoticeState,
  type CommitteeProgress,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { listCommitteeNotices, listCommitteeParticipants, listCommitteeProgress } from '../api'

const dayFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const momentFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const sectionClass = 'flex flex-col gap-3 rounded-lg border border-border bg-card p-4'

// ROADMAP E08.06, for the workspace's conseillers (and Confluent's administrators) on a committee's
// page: where it stands — its requests by status and its participants, counted (no name). Read again
// whenever the committee changes (`committee.version`) or a request or participant on this page does
// (`revision`).
export function CommitteeProgressSection({
  workspaceId,
  committee,
  revision = 0,
}: {
  workspaceId: string
  committee: Committee
  // Bumped by the page after a decision on a request or a participant (code review R70): their
  // own versions change, not the committee's.
  revision?: number
}) {
  const query = useAsync(
    () => listCommitteeProgress(workspaceId),
    [workspaceId, committee.id, committee.version, revision],
  )
  const progress = query.data?.find((p) => p.committeeId === committee.id)
  return (
    <section aria-labelledby="committee-progress-title" className={sectionClass}>
      <h2
        id="committee-progress-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Avancement
      </h2>
      {query.error ? (
        <p role="alert" className="text-sm text-foreground">
          Impossible de charger l’avancement. Réessayez plus tard.
        </p>
      ) : !progress ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <ProgressFigures progress={progress} />
      )}
    </section>
  )
}

function ProgressFigures({ progress }: { progress: CommitteeProgress }) {
  const { applications, participants } = progress
  const figures: Array<[string, number, string]> = [
    ['retained', applications.accepted, 'Demandes retenues'],
    ['applied', applications.applied, 'Candidatures à traiter'],
    ['proposed', applications.proposed, 'Propositions en attente du porteur'],
    ['refused', applications.refused + applications.withdrawn, 'Refusées ou retirées'],
    ['participants', participants.accepted, 'Participants acceptés'],
    ['pending', participants.pending, 'Demandes de participation à traiter'],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {figures.map(([key, value, label]) => (
        <div
          key={key}
          data-testid={`progress-${key}`}
          className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border p-3"
        >
          <dt className="text-xs text-muted-foreground wrap-anywhere">{label}</dt>
          <dd className="font-heading text-xl font-semibold text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ROADMAP E08.06, for the workspace's managers: the people accepted for this session (E08.05), and
// whether their account still is an active member — the only ones who read the session and are told
// of its changes.
export function CommitteeParticipantsSection({
  workspaceId,
  committee,
  revision = 0,
}: {
  workspaceId: string
  committee: Committee
  // Bumped by the page after a decision on a request or a participant (code review R70): their
  // own versions change, not the committee's.
  revision?: number
}) {
  const query = useAsync(
    () => listCommitteeParticipants(workspaceId, committee.id),
    [workspaceId, committee.id, committee.version, revision],
  )
  return (
    <section aria-labelledby="committee-participants-title" className={sectionClass}>
      <h2
        id="committee-participants-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Participants
        {query.data && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({query.data.filter((p) => p.access === 'active').length})
          </span>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">
        Les personnes dont vous avez accepté la demande de participation à cette session. Depuis la
        page du workspace, elles en voient la date, le lieu, le lien et les informations diffusées —
        jamais les notes internes, les demandes rattachées ni les autres participants.
      </p>
      {query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {(query.error as ApiError).message ?? 'Participants indisponibles pour le moment.'}
        </p>
      ) : !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun participant accepté pour ce comité.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Participants du comité">
          {query.data.map((p) => (
            <li
              key={p.requestId}
              data-testid="committee-participant"
              className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 wrap-anywhere text-sm font-medium text-foreground">
                  {p.name}
                  {p.organization && (
                    <span className="font-normal text-muted-foreground"> · {p.organization}</span>
                  )}
                </p>
                <Badge variant={p.access === 'active' ? 'default' : 'outline'}>
                  {p.access === 'active' ? 'Accès actif' : 'Accès retiré'}
                </Badge>
              </div>
              <p className="break-all text-sm text-foreground">{p.email}</p>
              <p className="text-xs text-muted-foreground">
                {p.decidedAt ? `Acceptée le ${dayFr(p.decidedAt)}` : 'Acceptée'}
                {p.access === 'inactive' &&
                  ' · n’est plus membre actif du workspace : ne voit plus cette session et n’est plus prévenu de ses changements.'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const STATE_VARIANTS: Record<
  CommitteeNoticeState,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  to_send: 'outline',
  sending: 'outline',
  sent: 'secondary',
  failed: 'destructive',
  superseded: 'outline',
}

// ROADMAP E08.06, for the workspace's managers: who was told, by email, of each change of date,
// cancellation or restoration of this committee, and what became of each email — the latest change
// first. The change stands whatever the emails did.
export function CommitteeNoticesSection({
  workspaceId,
  committee,
}: {
  workspaceId: string
  committee: Committee
}) {
  const query = useAsync(
    () => listCommitteeNotices(workspaceId, committee.id),
    [workspaceId, committee.id, committee.version],
  )
  const changes = groupByChange(query.data ?? [])
  return (
    <section aria-labelledby="committee-notices-title" className={sectionClass}>
      <h2
        id="committee-notices-title"
        className="font-heading text-lg font-semibold text-foreground"
      >
        Notifications
      </h2>
      <p className="text-sm text-muted-foreground">
        Un changement de date, d’heure ou de fuseau, une annulation ou un rétablissement prévient
        par email les porteurs des demandes rattachées (candidature, proposition ou demande retenue)
        et les participants acceptés. L’email donne le nom du comité et sa date, jamais le lieu, le
        lien, les informations diffusées ni les notes internes : chacun les lit en se connectant.
      </p>
      {query.error ? (
        <p role="alert" className="text-sm text-foreground">
          {(query.error as ApiError).message ?? 'Notifications indisponibles pour le moment.'}
        </p>
      ) : !query.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune notification envoyée pour ce comité.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Notifications du comité">
          {changes.map(({ version, kind, createdAt, notices }) => (
            <li
              key={version}
              data-testid="committee-notice-change"
              className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3"
            >
              <p className="text-sm font-medium text-foreground">
                {COMMITTEE_NOTICE_KIND_LABELS[kind]}
                <span className="font-normal text-muted-foreground"> · {momentFr(createdAt)}</span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {notices.map((n) => (
                  <li
                    key={n.id}
                    data-testid="committee-notice"
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                  >
                    <span className="min-w-0 wrap-anywhere text-foreground">{n.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {n.audience === 'entrepreneur' ? 'porteur' : 'participant'}
                    </span>
                    <Badge variant={STATE_VARIANTS[n.state]}>
                      {COMMITTEE_NOTICE_STATE_LABELS[n.state]}
                    </Badge>
                  </li>
                ))}
              </ul>
              {notices.some((n) => n.state === 'failed') && (
                <p className="text-xs text-foreground">
                  Un email n’a pas pu partir : prévenez la personne par un autre moyen. Elle voit le
                  comité à jour en se connectant.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function groupByChange(notices: CommitteeNotice[]) {
  const changes: Array<{
    version: number
    kind: CommitteeNotice['kind']
    createdAt: string
    notices: CommitteeNotice[]
  }> = []
  for (const notice of notices) {
    const last = changes[changes.length - 1]
    if (last && last.version === notice.committeeVersion) last.notices.push(notice)
    else
      changes.push({
        version: notice.committeeVersion,
        kind: notice.kind,
        createdAt: notice.createdAt,
        notices: [notice],
      })
  }
  return changes
}
