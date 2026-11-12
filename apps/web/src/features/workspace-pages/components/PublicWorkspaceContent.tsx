import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PublicPageBlock, PublicWorkspacePage } from '@confluent/shared'
import { buttonVariants } from '@/components/ui/button'
import { CommitteeWhen } from '@/features/committees/components/CommitteeSummary'
import { entrepreneurAccessFormPath } from '@/features/entrepreneur-access/api'
import { PublicCardView } from '@/features/showcase-cards/components/PublicCardView'
import { cn } from '@/lib/utils'

// ROADMAP E09.01: what a workspace's public page shows — identity, presentation, criteria, the next
// sessions offered to participation requests, how to apply and to take part, contact and sign-in —,
// for the public (`/w/:slug`) and, as a preview, for its managers. Texts are plain: shown as typed,
// line breaks kept, never interpreted as HTML or Markdown. No sign-up: accounts are created on
// invitation — E09.05: an entrepreneur without one asks the structure for access to its candidature
// path (`/w/:slug/candidater`), which its managers accept or refuse. E09.02: the anonymous cards of the requests whose
// owners consented to show them here, under their pseudonym. E09.04: below the header, the blocks its
// managers chose, in their order (`page.blocks`, built by @confluent/shared `toPublicWorkspacePage`
// for the public and for the managers' preview alike).
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
  const { workspace, committees, receivesCandidatures, receivesParticipationRequests, cards } = page
  const structure = workspace.programName ?? workspace.name
  const [logoFailed, setLogoFailed] = useState(false)
  const Title = titleLevel === 1 ? 'h1' : 'h2'
  const Heading = titleLevel === 1 ? 'h2' : 'h3'
  const participate = `/w/${encodeURIComponent(workspace.slug)}/participer`

  // Each block as the API sent it: listed only when shown and with something to show.
  function renderBlock(block: PublicPageBlock): ReactNode {
    switch (block) {
      case 'presentation':
        return (
          workspace.presentation && (
            <Section heading="Présentation" as={Heading}>
              <PlainText text={workspace.presentation} />
            </Section>
          )
        )
      case 'criteria':
        return (
          workspace.criteria && (
            <Section heading="Critères" as={Heading}>
              <PlainText text={workspace.criteria} />
            </Section>
          )
        )
      case 'contact':
        return (
          workspace.contact && (
            <Section heading="Contact" as={Heading}>
              <PlainText text={workspace.contact} />
            </Section>
          )
        )
      case 'committees':
        return (
          committees.length > 0 && (
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
          )
        )
      case 'cards':
        return (
          cards.length > 0 && (
            <Section heading="Projets accompagnés" as={Heading}>
              <p className="text-sm text-muted-foreground">
                Des demandes de financement présentées à {structure}, affichées à l’initiative de
                leurs porteurs sous un pseudonyme qu’ils ont choisi.
              </p>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {cards.map((card, i) => (
                  <li key={`${i}-${card.pseudonym}`} className="flex min-w-0">
                    <PublicCardView card={card} headingLevel={titleLevel === 1 ? 3 : 4} />
                  </li>
                ))}
              </ul>
            </Section>
          )
        )
      case 'apply':
        return (
          receivesCandidatures && (
            <CallToAction heading="Vous portez un projet ?" as={Heading}>
              <p className="text-sm text-foreground">
                Présentez votre demande de financement à {structure} depuis un compte
                Confluent&nbsp;: connectez-vous, ouvrez votre demande, puis choisissez{' '}
                {'«\u00a0Présenter la demande à une structure\u00a0»'}.
              </p>
              <p className="text-sm text-foreground">
                Pas encore de compte&nbsp;? Demandez un accès&nbsp;: la structure étudie chaque
                demande et vous invite par email si elle l’accepte.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Link
                  to={entrepreneurAccessFormPath(workspace.slug)}
                  className={cn(buttonVariants({ size: 'lg' }), 'h-11')}
                >
                  Demander un accès pour candidater
                </Link>
                <Link
                  to="/auth"
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11')}
                >
                  J’ai déjà un compte
                </Link>
              </div>
            </CallToAction>
          )
        )
      case 'participate':
        return (
          receivesParticipationRequests && (
            <CallToAction heading="Investisseur ou invité ?" as={Heading}>
              <p className="text-sm text-foreground">
                Demandez à participer à une session de comité : la structure examine chaque demande
                avant de donner un accès.
              </p>
              <Link
                to={participate}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'h-11 self-start',
                )}
              >
                Demander à participer
              </Link>
            </CallToAction>
          )
        )
      default:
        // A block this version of the site does not know: nothing (closed by default).
        return null
    }
  }

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

      {page.blocks.map((block) => (
        <Fragment key={block}>{renderBlock(block)}</Fragment>
      ))}

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
