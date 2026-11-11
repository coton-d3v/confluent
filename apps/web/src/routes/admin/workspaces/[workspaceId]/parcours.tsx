import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { listSupportSteps } from '@/features/support-paths/api'
import { SupportStepsPanel } from '@/features/support-paths/components/SupportStepsPanel'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// The support path of a workspace (ROADMAP E06.06), configured by Confluent administrators and the
// workspace's managers; the API decides who may, at each request.
export default function AdminWorkspaceSupportPathRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceSupportPath key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceSupportPath({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const steps = useAsync(() => listSupportSteps(workspaceId), [workspaceId])
  const error = (workspace.error ?? steps.error) as ApiError | null

  if (error) {
    if (error.status === 403) return <WorkspaceNotManaged />
    return (
      <p className="pt-8 text-sm text-destructive">
        {error.status === 404 || error.status === 400
          ? 'Workspace introuvable.'
          : 'Impossible de charger le parcours d’accompagnement du workspace.'}
      </p>
    )
  }
  if (!workspace.data || !steps.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <>
      <title>{`Parcours d’accompagnement · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 max-w-3xl">
        <SupportStepsPanel
          workspaceId={workspace.data.id}
          steps={steps.data}
          onChange={steps.refetch}
        />
      </div>
    </>
  )
}
