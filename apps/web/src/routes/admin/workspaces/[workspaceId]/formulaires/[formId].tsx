import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { getWorkspace } from '@/features/admin/workspaces.api'
import { useCurrentUser } from '@/features/current-user/context'
import { FormEditor } from '@/features/form-builder/components/FormEditor'
import { workspaceFormsPlace } from '@/features/form-builder/place'
import { WorkspaceNotManaged } from '@/features/workspaces/components/WorkspacePageHeader'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// E05.09: the builder of one of a workspace's forms, for its managers and Confluent's
// administrators; the API decides who may, at each request.
export default function AdminWorkspaceFormEditorRoute() {
  const { workspaceId = '', formId } = useParams()
  if (!formId) return <Navigate to={`/admin/workspaces/${workspaceId}/formulaires`} replace />
  return (
    <WorkspaceFormEditor key={`${workspaceId}/${formId}`} workspaceId={workspaceId} formId={formId} />
  )
}

function WorkspaceFormEditor({ workspaceId, formId }: { workspaceId: string; formId: string }) {
  const me = useCurrentUser()
  const workspace = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  const place = useMemo(() => workspaceFormsPlace(workspaceId), [workspaceId])

  if (!workspace.data) {
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
    return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>
  }

  const ws = workspace.data
  return (
    <FormEditor
      place={place}
      formId={formId}
      onForbidden={<WorkspaceNotManaged />}
      trail={(name) => (
        <nav aria-label="Fil d’Ariane" className="wrap-anywhere text-xs text-muted-foreground">
          {me.role === 'admin' ? (
            <Link to="/admin/workspaces" className="hover:underline">
              Workspaces
            </Link>
          ) : (
            <Link to="/workspaces" className="hover:underline">
              Mes workspaces
            </Link>
          )}
          {' / '}
          <Link to={`/admin/workspaces/${ws.id}`} className="hover:underline">
            {ws.name}
          </Link>
          {' / '}
          <Link to={place.listPath} className="hover:underline">
            Formulaires
          </Link>
          {' / '}
          <span className="text-foreground">{name}</span>
        </nav>
      )}
    />
  )
}
