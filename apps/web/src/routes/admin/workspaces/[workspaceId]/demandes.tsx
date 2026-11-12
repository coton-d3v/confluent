import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { EntrepreneurAccessRequestsSection } from '@/features/entrepreneur-access/components/EntrepreneurAccessRequestsSection'
import { ParticipationRequestsSection } from '@/features/participation/components/ParticipationRequestsSection'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// ROADMAP E09.05: what the public forms of a workspace feed, in one place for its managers — the
// entrepreneurs' access requests (from the « Appel à candidater » block of its public page) and every
// participation request (E08.04–E08.05, also on each committee's page). The API decides who may, at
// each request: its managers and Confluent's administrators.
export default function AdminWorkspaceRequestsRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceRequests key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceRequests({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])

  if (workspace.error) {
    const status = (workspace.error as ApiError).status
    if (status === 403) return <WorkspaceNotManaged />
    return (
      <p className="pt-8 text-sm text-destructive">
        {status === 404 || status === 400
          ? 'Workspace introuvable.'
          : 'Impossible de charger le workspace.'}
      </p>
    )
  }
  if (!workspace.data) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>

  return (
    <>
      <title>{`Demandes reçues · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        <EntrepreneurAccessRequestsSection workspace={workspace.data} />
        <ParticipationRequestsSection workspace={workspace.data} />
      </div>
    </>
  )
}
