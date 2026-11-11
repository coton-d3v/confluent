import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  INVESTOR_TYPE_LABELS,
  WORKSPACE_MEMBER_ROLE_LABELS,
  canPrepareCompanies,
  canReviewCandidatures,
  type CurrentWorkspace,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { useCurrentUser } from '@/features/current-user/context'
import { PreparedCompaniesSection } from '@/features/company-transfers/components/PreparedCompaniesSection'
import { ReceivedCandidaturesSection } from '@/features/candidatures/components/ReceivedCandidaturesSection'
import { FundingSourcesSection } from '@/features/funding-sources/components/FundingSourcesSection'
import { enterWorkspace } from '@/features/workspaces/api'
import { forgetWorkspace, rememberWorkspace } from '@/features/workspaces/current-workspace'
import { useWorkspaceMemberships } from '@/features/workspaces/memberships-context'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// A workspace as one of its members enters it (ROADMAP E05.03): its identity, the person's role in
// it and, for its managers, the way to its settings and members. The API decides at each request
// whether the person is (still) in it.
export default function WorkspaceRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceHome key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceHome({ workspaceId }: { workspaceId: string }) {
  const me = useCurrentUser()
  const { refresh } = useWorkspaceMemberships()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const entered = useAsync(() => enterWorkspace(workspaceId), [workspaceId])
  const closed = (entered.error as ApiError | null)?.status === 404

  useEffect(() => {
    if (entered.data) {
      rememberWorkspace(me.id, workspaceId)
      headingRef.current?.focus()
    }
  }, [entered.data, me.id, workspaceId])

  // No longer in it (deactivated meanwhile) or never was: forget it and reload the memberships, so
  // that the switcher stops offering it.
  useEffect(() => {
    if (closed) {
      forgetWorkspace(me.id, workspaceId)
      refresh()
    }
  }, [closed, me.id, workspaceId, refresh])

  if (!entered.data) {
    if (closed) {
      return (
        <div className="flex flex-col items-start gap-2 pt-8">
          <title>Workspace introuvable · Confluent</title>
          <p role="alert" className="text-sm text-foreground">
            Ce workspace est introuvable, ou vous n’en êtes pas membre.
          </p>
          <Link to="/workspaces" className="text-sm text-foreground underline underline-offset-4">
            Voir mes workspaces
          </Link>
        </div>
      )
    }
    if (entered.error) {
      return (
        <p role="alert" className="pt-8 text-sm text-destructive">
          Impossible d’ouvrir ce workspace. Réessayez plus tard.
        </p>
      )
    }
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  const { workspace, membership, canManageWorkspace } = entered.data
  return (
    <>
      <title>{`${workspace.name} · Confluent`}</title>
      <nav aria-label="Fil d’Ariane" className="text-xs text-muted-foreground wrap-anywhere">
        <Link to="/workspaces" className="hover:underline">
          Mes workspaces
        </Link>
        {' / '}
        <span className="text-foreground">{workspace.name}</span>
      </nav>

      <div className="mt-4 flex max-w-3xl items-start gap-4">
        <WorkspaceMark workspace={workspace} />
        <div className="min-w-0 flex-1">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
          >
            {workspace.name}
          </h1>
          {workspace.programName && (
            <Badge
              variant="outline"
              className="mt-2 h-auto max-w-full whitespace-normal text-left wrap-anywhere"
            >
              {workspace.programName}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        <section aria-labelledby="ws-role-title" className="rounded-lg border border-border p-4">
          <h2 id="ws-role-title" className="text-sm font-medium text-muted-foreground">
            Votre place dans ce workspace
          </h2>
          <p className="mt-1 text-base text-foreground">{roleLine(entered.data)}</p>
          {canManageWorkspace && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/admin/workspaces/${workspace.id}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Réglages
              </Link>
              <Link
                to={`/admin/workspaces/${workspace.id}/membres`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Membres
              </Link>
              <Link
                to={`/admin/workspaces/${workspace.id}/formulaires`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Formulaires
              </Link>
              <Link
                to={`/admin/workspaces/${workspace.id}/sources`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Sources de financement
              </Link>
            </div>
          )}
          {!membership && (
            <p className="mt-2 text-sm text-muted-foreground">
              Vous y accédez en tant qu’administrateur de Confluent, sans en être membre.
            </p>
          )}
        </section>

        {/* E05.09: the candidatures it receives, for its conseillers. */}
        {canReviewCandidatures(me, membership) && (
          <ReceivedCandidaturesSection workspaceId={workspace.id} />
        )}

        {/* E06.02: the sources its financing plans are split into, for its conseillers. */}
        {canReviewCandidatures(me, membership) && (
          <FundingSourcesSection workspaceId={workspace.id} canManage={canManageWorkspace} />
        )}

        {/* E05.08: its conseillers prepare companies for entrepreneurs. */}
        {canPrepareCompanies(membership) && <PreparedCompaniesSection workspaceId={workspace.id} />}

        {workspace.presentation && (
          <section aria-labelledby="ws-presentation-title">
            <h2
              id="ws-presentation-title"
              className="font-heading text-lg font-semibold text-foreground"
            >
              Présentation
            </h2>
            <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">
              {workspace.presentation}
            </p>
          </section>
        )}

        {workspace.contactEmail && (
          <p className="text-sm text-foreground">
            Contact :{' '}
            <a
              href={`mailto:${workspace.contactEmail}`}
              className="break-all underline underline-offset-4"
            >
              {workspace.contactEmail}
            </a>
          </p>
        )}
      </div>
    </>
  )
}

function roleLine({ membership, canManageWorkspace }: CurrentWorkspace): string {
  if (!membership) return 'Administrateur de Confluent'
  const parts = [
    WORKSPACE_MEMBER_ROLE_LABELS[membership.role] +
      (canManageWorkspace ? ', gestionnaire du workspace' : ''),
    membership.organization,
    membership.investorType ? INVESTOR_TYPE_LABELS[membership.investorType] : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function WorkspaceMark({ workspace }: { workspace: CurrentWorkspace['workspace'] }) {
  if (workspace.logo?.url) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
        <img
          src={workspace.logo.url}
          alt={`Logo de ${workspace.name}`}
          className="size-full object-contain p-1"
        />
      </div>
    )
  }
  return (
    <div
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-lg font-semibold text-white"
      style={workspace.color ? { backgroundColor: workspace.color } : undefined}
    >
      <span className={workspace.color ? undefined : 'text-muted-foreground'}>
        {workspace.name.charAt(0).toUpperCase()}
      </span>
    </div>
  )
}
