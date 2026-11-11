import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ReceivedCandidature } from '@confluent/shared'
import { getReceivedCandidature } from '@/features/candidatures/api'
import { AnswersReadout } from '@/features/candidatures/components/AnswersReadout'
import { RequestPresentation } from '@/features/dossiers/components/RequestPresentation'
import { hasPresentation } from '@/features/dossiers/presentation'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

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
  const back = (
    <Link to={`/workspaces/${workspaceId}`} className="text-sm text-foreground underline underline-offset-4">
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
  return <ReceivedCandidatureView workspaceId={workspaceId} candidature={query.data} />
}

function ReceivedCandidatureView({
  workspaceId,
  candidature,
}: {
  workspaceId: string
  candidature: ReceivedCandidature
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
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Reçue le {dateFr(candidature.submittedAt)} · {name ? `${name} · ` : ''}
          <a href={`mailto:${applicant.email}`} className="underline underline-offset-4">
            {applicant.email}
          </a>
        </p>
      </header>

      <div className="mt-6 flex max-w-3xl flex-col gap-8">
        <section aria-labelledby="rc-request">
          <h2 id="rc-request" className="font-heading text-lg font-semibold text-foreground">
            La demande
          </h2>
          <div className="mt-3">
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
