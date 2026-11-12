import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { FormsList } from '@/features/form-builder/components/FormsList'
import { workspaceFormsPlace } from '@/features/form-builder/place'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'
import { adminFailure } from '@/features/admin/failure'
import { LoadError } from '@/components/confluent/LoadError'

// E05.09: a workspace's own forms — its complementary form for candidatures — for its managers and
// Confluent's administrators; the API decides who may, at each request.
export default function AdminWorkspaceFormsRoute() {
  const { workspaceId = '' } = useParams()
  return <WorkspaceForms key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceForms({ workspaceId }: { workspaceId: string }) {
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const place = useMemo(() => workspaceFormsPlace(workspaceId), [workspaceId])

  if (!workspace.data) {
    if (workspace.error) {
      const status = (workspace.error as ApiError).status
      if (status === 403) return <WorkspaceNotManaged />
      if (status === 404 || status === 400) {
        return <p className="pt-8 text-sm text-destructive">Workspace introuvable.</p>
      }
      return (
        <LoadError
          className="mt-8"
          message={adminFailure(workspace.error, 'Le workspace n’a pas pu être chargé.')}
          onRetry={workspace.refetch}
        />
      )
    }
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <>
      <title>{`Formulaires · ${workspace.data.name} · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace.data} />
      <div className="mt-6 max-w-3xl">
        <FormsList
          place={place}
          onForbidden={<WorkspaceNotManaged />}
          title={
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Formulaires de la structure
            </h2>
          }
        />
      </div>
    </>
  )
}
