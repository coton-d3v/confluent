import { useState } from 'react'
import { isUpcoming, placeLine } from '../format'
import { listMyCommitteeSessions } from '../api'
import { useAsync } from '@/lib/useAsync'
import { CommitteeStatusBadge, CommitteeWhen } from './CommitteeSummary'

// ROADMAP E08.06, on a workspace's page for a member it accepted as a participant (E08.05): the
// sessions they take part in, as the shared view the API serves them — name, when, place, link,
// status and shared information; never the internal notes, the requests on the agenda nor the other
// participants. Nothing is shown to a member who takes part in none.
export function ParticipantSessionsSection({ workspaceId }: { workspaceId: string }) {
  const query = useAsync(() => listMyCommitteeSessions(workspaceId), [workspaceId])
  const [now] = useState(() => Date.now())
  if (query.error) {
    return (
      <p role="alert" className="text-sm text-foreground">
        Impossible de charger vos sessions de comité. Réessayez plus tard.
      </p>
    )
  }
  if (!query.data || query.data.length === 0) return null
  // The next ones first, then the past and cancelled ones, latest first.
  const upcoming = query.data.filter((c) => isUpcoming(c, now))
  const others = query.data.filter((c) => !upcoming.includes(c)).reverse()
  return (
    <section aria-labelledby="ws-sessions-title" className="flex flex-col gap-3">
      <h2 id="ws-sessions-title" className="font-heading text-lg font-semibold text-foreground">
        Vos sessions de comité
      </h2>
      <p className="text-sm text-muted-foreground">
        Les sessions pour lesquelles votre demande de participation a été acceptée. Vous êtes
        prévenu par email si leur date change ou si elles sont annulées.
      </p>
      <ul aria-label="Vos sessions de comité" className="flex flex-col gap-2">
        {[...upcoming, ...others].map((c) => (
          <li
            key={c.id}
            data-testid="participant-session"
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 wrap-anywhere text-base font-medium text-foreground">
                {c.name}
              </p>
              <CommitteeStatusBadge status={c.status} />
            </div>
            <CommitteeWhen committee={c} />
            <p className="wrap-anywhere text-sm text-foreground">{placeLine(c)}</p>
            {c.meetingUrl && c.status !== 'cancelled' && (
              <a
                href={c.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm text-foreground underline underline-offset-4"
              >
                {c.meetingUrl}
              </a>
            )}
            {c.sharedInfo && (
              <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
                {c.sharedInfo}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
