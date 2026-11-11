import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ReceivedCandidature, ReceivedFinancingStatusChange } from '@confluent/shared'
import { changeReceivedFinancingStatus, getReceivedCandidature } from '@/features/candidatures/api'
import { AnswersReadout } from '@/features/candidatures/components/AnswersReadout'
import {
  FinancingStatusBadge,
  FinancingStatusPanel,
} from '@/features/candidatures/components/FinancingStatusPanel'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { EligibilitiesPanel } from '@/features/eligibilities/components/EligibilitiesPanel'
import { FundingPlanPanel } from '@/features/funding-plans/components/FundingPlanPanel'
import { SupportPathPanel } from '@/features/support-paths/components/SupportPathPanel'
import { hasPresentation } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

const personOf = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email

// Who made a change, as the structure knows it: its member or the entrepreneur, by name.
const describeBy = (change: ReceivedFinancingStatusChange) => {
  const who = change.actor ? personOf(change.actor) : 'un compte supprimé'
  return change.by === 'owner' ? `par le porteur de projet (${who})` : `par ${who}`
}

// ROADMAP E05.09: a candidature the workspace received, as its conseillers read it — the request's
// presentation, the company's common profile and the answers to the workspace's own form.
export default function ReceivedCandidatureRoute() {
  const { workspaceId = '', candidatureId = '' } = useParams()
  return (
    <ReceivedCandidaturePage
      key={`${workspaceId}/${candidatureId}`}
      workspaceId={workspaceId}
      candidatureId={candidatureId}
    />
  )
}

function ReceivedCandidaturePage({
  workspaceId,
  candidatureId,
}: {
  workspaceId: string
  candidatureId: string
}) {
  const query = useAsync(
    () => getReceivedCandidature(workspaceId, candidatureId),
    [workspaceId, candidatureId],
  )
  // The candidature as a change of its status left it, until the page is left.
  const [current, setCurrent] = useState<ReceivedCandidature | null>(null)
  const back = (
    <Link
      to={`/workspaces/${workspaceId}`}
      className="text-sm text-foreground underline underline-offset-4"
    >
      Retour au workspace
    </Link>
  )
  if (!query.data) {
    if (query.error) {
      const status = (query.error as ApiError).status
      return (
        <div className="flex flex-col items-start gap-2 pt-8">
          <title>Candidature introuvable · Confluent</title>
          <p role="alert" className="text-sm text-foreground">
            {status === 403
              ? 'Les candidatures reçues par ce workspace sont lues par ses conseillers.'
              : status === 404 || status === 400
                ? 'Cette candidature est introuvable dans ce workspace.'
                : 'Impossible de charger la candidature. Réessayez plus tard.'}
          </p>
          {back}
        </div>
      )
    }
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }
  return (
    <ReceivedCandidatureView
      workspaceId={workspaceId}
      candidature={current ?? query.data}
      onChange={setCurrent}
    />
  )
}

function ReceivedCandidatureView({
  workspaceId,
  candidature,
  onChange,
}: {
  workspaceId: string
  candidature: ReceivedCandidature
  onChange: (next: ReceivedCandidature) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  const { applicant, company, dossier, profile, form } = candidature
  const name = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ')
  return (
    <>
      <title>{`${company.name} · Candidature · Confluent`}</title>
      <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
        <Link to={`/workspaces/${workspaceId}`} className="hover:underline">
          Workspace
        </Link>
        {' / '}
        <span className="text-foreground">Candidature de {company.name}</span>
      </nav>
      <header className="mt-4 flex max-w-3xl flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
        >
          {company.name} — {dossier.name}
        </h1>
        <div className="mt-1">
          <FinancingStatusBadge status={candidature.financingStatus} />
        </div>
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Reçue le {dateFr(candidature.submittedAt)} · {name ? `${name} · ` : ''}
          <a href={`mailto:${applicant.email}`} className="underline underline-offset-4">
            {applicant.email}
          </a>
        </p>
      </header>

      <div className="mt-6 flex max-w-3xl flex-col gap-8">
        <FinancingStatusPanel
          actor="workspace"
          status={candidature.financingStatus}
          changedAt={candidature.financingStatusChangedAt}
          history={candidature.statusHistory}
          describeBy={describeBy}
          intro="Où en est cette demande dans votre structure : vous seuls et l’entreprise le voyez, aucune autre structure ni aucun investisseur."
          confirmText={(to) =>
            to === 'abandoned'
              ? 'L’entreprise verra que sa demande est notée abandonnée par votre structure. Vous pourrez la rouvrir.'
              : 'L’entreprise verra ce statut sur sa candidature. Vous pourrez la rouvrir.'
          }
          onTransition={async (to) => {
            onChange(
              await changeReceivedFinancingStatus(workspaceId, candidature.id, {
                from: candidature.financingStatus,
                to,
              }),
            )
          }}
          onStale={() => {
            void getReceivedCandidature(workspaceId, candidature.id).then(onChange, () => undefined)
          }}
        />

        <SupportPathPanel
          scope={{ side: 'workspace', workspaceId, candidatureId: candidature.id }}
          intro="Les étapes du parcours d’accompagnement de votre structure pour cette demande. Validez une étape une fois franchie : l’entreprise voit la date de validation, pas votre nom ; aucune autre structure ni aucun investisseur ne voit ce parcours."
        />

        <FundingPlanPanel
          scope={{ side: 'workspace', workspaceId, candidatureId: candidature.id }}
          intro="Les sources de financement de cette demande, réparties selon les sources de votre structure. L’entreprise et vous pouvez compléter ce plan ; aucune autre structure ni aucun investisseur ne le voit."
          describeSide={(side) => (side === 'owner' ? 'par l’entreprise' : 'par votre structure')}
          noObjective="L’entreprise n’a pas indiqué le montant recherché de cette demande : le reste à financer ne peut pas être calculé."
        />

        <EligibilitiesPanel
          scope={{ side: 'workspace', workspaceId, candidatureId: candidature.id }}
          intro="Les dispositifs de votre structure auxquels l’entreprise se déclare éligible pour cette demande. Vous pouvez en indiquer et marquer une éligibilité vérifiée par votre structure ; aucune autre structure ni aucun investisseur ne les voit."
          describeSide={(side) => (side === 'owner' ? 'par l’entreprise' : 'par votre structure')}
        />

        <section aria-labelledby="rc-request">
          <h2 id="rc-request" className="font-heading text-lg font-semibold text-foreground">
            La demande
          </h2>
          <div className="mt-3">
            {dossier.publicationStatus === 'archived' && (
              <p className="mb-3 text-sm text-muted-foreground">
                L’entreprise a archivé cette demande : elle l’a close de son côté, son statut chez
                vous reste le vôtre.
              </p>
            )}
            {hasPresentation(dossier) ? (
              <RequestPresentation dossier={dossier} />
            ) : (
              <p className="text-sm text-muted-foreground">
                L’entreprise n’a pas encore rédigé la présentation de cette demande.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="rc-form">
          <h2 id="rc-form" className="font-heading text-lg font-semibold text-foreground">
            Réponses à votre formulaire
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {form.name}, version {form.version.version}. Ces réponses ne sont lues que par les
            conseillers de votre workspace.
          </p>
          <div className="mt-4">
            <AnswersReadout sections={form.sections} fields={form.fields} answers={form.answers} />
          </div>
        </section>

        <section aria-labelledby="rc-profile">
          <h2 id="rc-profile" className="font-heading text-lg font-semibold text-foreground">
            Profil de l’entreprise
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Le profil commun, renseigné une fois par l’entreprise pour toutes les structures. Les
            pièces jointes ne sont pas transmises par une candidature.
          </p>
          <div className="mt-4">
            <AnswersReadout
              sections={profile.sections}
              fields={profile.fields}
              answers={profile.answers}
            />
          </div>
        </section>
      </div>
    </>
  )
}
