import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { listEligibilitySchemes } from '@/features/eligibilities/api'
import { EligibilitySchemesPanel } from '@/features/eligibilities/components/EligibilitySchemesPanel'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { adminFailure } from '@/features/admin/failure'
import { LoadError } from '@/components/confluent/LoadError'

// The schemes of a workspace (ROADMAP E06.05), configured by Confluent administrators and the
// workspace's managers; the API decides who may, at each request.
export default function AdminWorkspaceSchemesRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceSchemes key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceSchemes({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const schemes = useAsync(() => listEligibilitySchemes(workspaceId), [workspaceId])
  const error = (workspace.error ?? schemes.error) as ApiError | null

  if (error) {
    if (error.status === 403) return <WorkspaceNotManaged />
    if (error.status === 404 || error.status === 400) {
      return <p className="pt-8 text-sm text-destructive">Workspace introuvable.</p>
    }
    return (
      <LoadError
        className="mt-8"
        message={adminFailure(error, 'Les dispositifs du workspace n’ont pas pu être chargés.')}
        onRetry={() => {
          workspace.refetch()
          schemes.refetch()
        }}
      />
    )
  }
  if (!workspace.data || !schemes.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <>
      <title>{`Dispositifs · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 max-w-3xl">
        <EligibilitySchemesPanel
          workspaceId={workspace.data.id}
          schemes={schemes.data}
          onChange={schemes.refetch}
        />
      </div>
    </>
  )
}
