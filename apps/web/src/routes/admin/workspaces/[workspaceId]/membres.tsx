import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { listWorkspaceMembers } from '@/features/admin/workspace-members.api'
import { WorkspaceMembersPanel } from '@/features/workspaces/components/WorkspaceMembersPanel'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { adminFailure } from '@/features/admin/failure'
import { LoadError } from '@/components/confluent/LoadError'

// Members of a workspace, for Confluent administrators and the workspace's managers (E05.02); the
// API decides who may, at each request.
export default function AdminWorkspaceMembersRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceMembers key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceMembers({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const members = useAsync(() => listWorkspaceMembers(workspaceId), [workspaceId])
  const error = (workspace.error ?? members.error) as ApiError | null

  if (error) {
    if (error.status === 403) return <WorkspaceNotManaged />
    if (error.status === 404 || error.status === 400) {
      return <p className="pt-8 text-sm text-destructive">Workspace introuvable.</p>
    }
    return (
      <LoadError
        className="mt-8"
        message={adminFailure(error, 'Les membres du workspace n’ont pas pu être chargés.')}
        onRetry={() => {
          workspace.refetch()
          members.refetch()
        }}
      />
    )
  }
  if (!workspace.data || !members.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <>
      <title>{`Membres · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 max-w-3xl">
        <WorkspaceMembersPanel
          workspace={workspace.data}
          members={members.data}
          onChange={members.refetch}
        />
      </div>
    </>
  )
}
