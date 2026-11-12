import { toSharedCommittee, type Committee } from '@confluent/shared'
import { placeLine } from '../format'
import { CommitteeStatusBadge, CommitteeWhen } from './CommitteeSummary'

// A committee's two texts, side by side and labelled with who reads them (ROADMAP E08.02): the
// internal notes stay with the workspace's conseillers; the shared information goes, with the name,
// date, place, link and status, to the committee's candidates and investors.
export function CommitteeTexts({ committee }: { committee: Committee }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section
        aria-labelledby="committee-internal-title"
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-4"
      >
        <h2 id="committee-internal-title" className="text-sm font-semibold text-foreground">
          Notes internes
        </h2>
        <p className="text-xs text-muted-foreground">
          Visibles des seuls conseillers de ce workspace et des administrateurs de Confluent. Jamais
          diffusées.
        </p>
        <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
          {committee.internalNotes ?? (
            <span className="text-muted-foreground">Aucune note interne.</span>
          )}
        </p>
      </section>
      <section
        aria-labelledby="committee-shared-title"
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4"
      >
        <h2 id="committee-shared-title" className="text-sm font-semibold text-foreground">
          Informations diffusées
        </h2>
        <p className="text-xs text-muted-foreground">
          Visibles des candidats et des investisseurs du comité.
        </p>
        <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
          {committee.sharedInfo ?? (
            <span className="text-muted-foreground">Aucune information diffusée.</span>
          )}
        </p>
      </section>
    </div>
  )
}

// What the committee's candidates and investors will read of it: the shared view of
// @confluent/shared, the one the API will serve them — never the internal notes.
export function SharedCommitteePreview({ committee }: { committee: Committee }) {
  const shared = toSharedCommittee(committee)
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-foreground">
        Aperçu : ce que verront les candidats et investisseurs
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4">
        <p className="text-xs text-muted-foreground">
          Aucun candidat ni investisseur n’a encore accès aux comités : voici ce qui leur sera
          montré lorsqu’ils y seront rattachés. Les notes internes n’en font jamais partie.
        </p>
        <div
          data-testid="committee-shared-preview"
          className="flex flex-col gap-3 rounded-md border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="wrap-anywhere text-base font-medium text-foreground">{shared.name}</p>
            <CommitteeStatusBadge status={shared.status} />
          </div>
          <CommitteeWhen committee={shared} />
          <p className="wrap-anywhere text-sm text-foreground">{placeLine(shared)}</p>
          {shared.meetingUrl && (
            <p className="break-all text-sm text-foreground">{shared.meetingUrl}</p>
          )}
          <p className="whitespace-pre-line wrap-anywhere text-sm text-foreground">
            {shared.sharedInfo ?? (
              <span className="text-muted-foreground">Aucune information diffusée.</span>
            )}
          </p>
        </div>
      </div>
    </details>
  )
}
