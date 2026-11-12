import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { listFundingSourceCategories } from '@/features/funding-sources/api'
import { FundingSourceCategoriesPanel } from '@/features/funding-sources/components/FundingSourceCategoriesPanel'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { adminFailure } from '@/features/admin/failure'
import { LoadError } from '@/components/confluent/LoadError'

// The categories of sources of a workspace's financing plans (ROADMAP E06.02), configured by
// Confluent administrators and the workspace's managers; the API decides who may, at each request.
export default function AdminWorkspaceSourcesRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceSources key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceSources({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const categories = useAsync(() => listFundingSourceCategories(workspaceId), [workspaceId])
  const error = (workspace.error ?? categories.error) as ApiError | null

  if (error) {
    if (error.status === 403) return <WorkspaceNotManaged />
    if (error.status === 404 || error.status === 400) {
      return <p className="pt-8 text-sm text-destructive">Workspace introuvable.</p>
    }
    return (
      <LoadError
        className="mt-8"
        message={adminFailure(error, 'Les sources de financement du workspace n’ont pas pu être chargées.')}
        onRetry={() => {
          workspace.refetch()
          categories.refetch()
        }}
      />
    )
  }
  if (!workspace.data || !categories.data) {
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <>
      <title>{`Sources de financement · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 max-w-3xl">
        <FundingSourceCategoriesPanel
          workspaceId={workspace.data.id}
          categories={categories.data}
          onChange={categories.refetch}
        />
      </div>
    </>
  )
}
