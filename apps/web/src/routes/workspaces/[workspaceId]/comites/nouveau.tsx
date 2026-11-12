import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { createCommittee } from '@/features/committees/api'
import { CommitteeForm } from '@/features/committees/components/CommitteeForm'
import {
  CommitteesTrail,
  CommitteesUnavailable,
} from '@/features/committees/components/CommitteesTrail'
import { enterWorkspace } from '@/features/workspaces/api'
import type { ApiError } from '@/lib/api-client'
import { useAsync } from '@/lib/useAsync'

// Planning a committee (ROADMAP E08.01), for the workspace's managers and Confluent's
// administrators. The API decides, at the request.
export default function NewCommitteeRoute() {
  const { workspaceId = '' } = useParams()
  return <NewCommittee key={workspaceId} workspaceId={workspaceId} />
}

function NewCommittee({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate()
  const entered = useAsync(() => enterWorkspace(workspaceId), [workspaceId])

  if (entered.error) return <CommitteesUnavailable error={entered.error as ApiError} />
  if (!entered.data) return <p className="pt-8 text-sm text-muted-foreground">Chargement…</p>

  const { workspace, canManageWorkspace } = entered.data
  return (
    <>
      <title>{`Programmer un comité · ${workspace.name} · Confluent`}</title>
      <CommitteesTrail workspace={workspace} committee="Nouveau" />
      <h1 className="mt-4 wrap-anywhere font-heading text-2xl font-semibold text-foreground md:text-[28px]">
        Programmer un comité
      </h1>
      <div className="mt-6 max-w-2xl">
        {canManageWorkspace ? (
          <CommitteeForm
            submitLabel="Programmer le comité"
            onCancel={() => navigate(`/workspaces/${workspace.id}/comites`)}
            onSubmit={async (input) => {
              const created = await createCommittee(workspace.id, input)
              toast.success(`« ${created.name} » est programmé.`)
              navigate(`/workspaces/${workspace.id}/comites/${created.id}`)
            }}
          />
        ) : (
          <p role="alert" className="text-sm text-foreground">
            Seuls les gestionnaires de ce workspace programment ses comités.
          </p>
        )}
      </div>
    </>
  )
}
