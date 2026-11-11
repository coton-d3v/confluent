import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { Workspace } from '@confluent/shared'
import { Separator } from '@/components/ui/separator'
import { useCurrentUser } from '@/features/current-user/context'
import { getWorkspace, updateWorkspace } from '@/features/admin/workspaces.api'
import { WorkspaceLogoPanel } from '@/features/workspaces/components/WorkspaceLogoPanel'
import {
  WorkspaceNotManaged,
  WorkspacePageHeader,
} from '@/features/workspaces/components/WorkspacePageHeader'
import { WorkspaceSettingsForm } from '@/features/workspaces/components/WorkspaceSettingsForm'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// Settings of a workspace, for Confluent administrators and the workspace's managers (E05.02): the
// API decides who may, at each request. The email domain stays with administrators.
export default function AdminWorkspaceRoute() {
  const { workspaceId = '' } = useParams()
  return <AdminWorkspace key={workspaceId} workspaceId={workspaceId} />
}

function AdminWorkspace({ workspaceId }: { workspaceId: string }) {
  const me = useCurrentUser()
  const loaded = useAsync(() => getWorkspace(workspaceId), [workspaceId])
  // The workspace as last returned by a change, otherwise as loaded.
  const [changed, setWorkspace] = useState<Workspace | null>(null)
  const workspace = changed ?? loaded.data ?? null
  // The settings form starts again from the values as last saved.
  const [revision, setRevision] = useState(0)

  if (!workspace) {
    if (loaded.error) {
      const status = (loaded.error as ApiError).status
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

  return (
    <>
      <title>{`${workspace.name} · Workspaces · Confluent`}</title>
      <WorkspacePageHeader workspace={workspace} />

      <div className="mt-6 flex max-w-2xl flex-col gap-6">
        <WorkspaceLogoPanel workspace={workspace} onChange={setWorkspace} />
        <Separator />
        <section aria-labelledby="ws-settings-title" className="flex flex-col gap-4">
          <h2 id="ws-settings-title" className="font-heading text-lg font-semibold text-foreground">
            Réglages
          </h2>
          <WorkspaceSettingsForm
            key={revision}
            workspace={workspace}
            canEditEmailDomain={me.role === 'admin'}
            submitLabel="Enregistrer les réglages"
            onSubmit={async (input) => {
              // Edition never sends the slug: it is fixed at creation.
              setWorkspace(await updateWorkspace(workspace.id, input))
              setRevision((n) => n + 1)
              toast.success('Réglages enregistrés.')
            }}
          />
        </section>
      </div>
    </>
  )
}
