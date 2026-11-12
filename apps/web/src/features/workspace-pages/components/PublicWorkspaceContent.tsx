import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PublicWorkspacePage } from '@confluent/shared'
import { buttonVariants } from '@/components/ui/button'
import { CommitteeWhen } from '@/features/committees/components/CommitteeSummary'
import { cn } from '@/lib/utils'

// ROADMAP E09.01: what a workspace's public page shows — identity, presentation, criteria, the next
// sessions offered to participation requests, how to apply and to take part, contact and sign-in —,
// for the public (`/w/:slug`) and, as a preview, for its managers. Texts are plain: shown as typed,
// line breaks kept, never interpreted as HTML or Markdown. No sign-up: accounts are created on
// invitation (E09.05 decides any other path).
export function PublicWorkspaceContent({
  page,
  logoSrc,
  titleLevel = 1,
}: {
  page: PublicWorkspacePage
  // Null: no logo shown.
  logoSrc: string | null
  // 2 inside another page (the managers' preview).
  titleLevel?: 1 | 2
}) {
  const { workspace, committees, receivesCandidatures } = page
  const structure = workspace.programName ?? workspace.name
  const [logoFailed, setLogoFailed] = useState(false)
  const Title = titleLevel === 1 ? 'h1' : 'h2'
  const Heading = titleLevel === 1 ? 'h2' : 'h3'
  const participate = `/w/${encodeURIComponent(workspace.slug)}/participer`

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header
        className="flex min-w-0 flex-col gap-3 border-t-4 pt-4"
        // The structure's colour as a decoration only: never behind or as text.
        style={{ borderTopColor: workspace.color ?? 'var(--border)' }}
      >
        {logoSrc && !logoFailed && (
          <img
            src={logoSrc}
            alt={`Logo de ${workspace.name}`}
            className="h-16 w-auto max-w-48 self-start object-contain"
            onError={() => setLogoFailed(true)}
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <Title className="wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px]">
            {structure}
          </Title>
          {workspace.programName && (
            <p className="wrap-anywhere text-sm text-muted-foreground">
              Programme de {workspace.name}
            </p>
          )}
        </div>
      </header>

      {workspace.presentation && (
        <Section heading="Présentation" as={Heading}>
          <PlainText text={workspace.presentation} />
        </Section>
      )}

      {workspace.criteria && (
        <Section heading="Critères" as={Heading}>
          <PlainText text={workspace.criteria} />
        </Section>
      )}

      {committees.length > 0 && (
        <Section heading="Prochains comités" as={Heading}>
          <ul className="flex flex-col gap-3">
            {committees.map((committee) => (
              <li
                key={committee.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4"
              >
                <p className="wrap-anywhere text-sm font-medium text-foreground">
                  {committee.name}
                </p>
                <CommitteeWhen committee={committee} />
                <Link
                  to={`${participate}?session=${encodeURIComponent(committee.id)}`}
                  className="self-start text-sm text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  Demander à participer
                  <span className="sr-only"> à « {committee.name} »</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(receivesCandidatures || committees.length > 0) && (
        <div className="flex flex-col gap-3">
          {receivesCandidatures && (
            <CallToAction heading="Vous portez un projet ?" as={Heading}>
              <p className="text-sm text-foreground">
                Présentez votre demande de financement à {structure} depuis votre compte
                Confluent&nbsp;: connectez-vous, ouvrez votre demande, puis choisissez{' '}
                {'«\u00a0Présenter la demande à une structure\u00a0»'}.
              </p>
              <p className="text-xs text-muted-foreground">
                Les comptes sont créés sur invitation : sans compte, contactez la structure.
              </p>
              <Link to="/auth" className={cn(buttonVariants({ size: 'lg' }), 'h-11 self-start')}>
                Se connecter pour candidater
              </Link>
            </CallToAction>
          )}
          {committees.length > 0 && (
            <CallToAction heading="Investisseur ou invité ?" as={Heading}>
              <p className="text-sm text-foreground">
                Demandez à participer à une session de comité : la structure examine chaque demande
                avant de donner un accès.
              </p>
              <Link
                to={participate}
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 self-start')}
              >
                Demander à participer
              </Link>
            </CallToAction>
          )}
        </div>
      )}

      {workspace.contact && (
        <Section heading="Contact" as={Heading}>
          <PlainText text={workspace.contact} />
        </Section>
      )}

      <p className="text-sm text-muted-foreground">
        Déjà membre de {structure} ou porteur de projet sur Confluent ?{' '}
        <Link
          to="/auth"
          className="text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Se connecter
        </Link>
      </p>
    </div>
  )
}

function Section({
  heading,
  as: Heading,
  children,
}: {
  heading: string
  as: 'h2' | 'h3'
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Heading className="font-heading text-lg font-semibold text-foreground">{heading}</Heading>
      {children}
    </section>
  )
}

function CallToAction({
  heading,
  as: Heading,
  children,
}: {
  heading: string
  as: 'h2' | 'h3'
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <Heading className="font-heading text-base font-semibold text-foreground">{heading}</Heading>
      {children}
    </section>
  )
}

function PlainText({ text }: { text: string }) {
  return <p className="wrap-anywhere whitespace-pre-line text-sm text-foreground">{text}</p>
}
