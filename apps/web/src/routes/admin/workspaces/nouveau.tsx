import { useEffect, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCurrentUser } from '@/features/current-user/context'
import { createWorkspace } from '@/features/admin/workspaces.api'
import { WorkspaceSettingsForm } from '@/features/workspaces/components/WorkspaceSettingsForm'

export default function AdminWorkspaceNewRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminWorkspaceNew />
}

function AdminWorkspaceNew() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <>
      <title>Nouveau workspace · Confluent</title>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Nouveau workspace
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Le logo se dépose une fois le workspace créé.
      </p>
      <div className="mt-6 max-w-2xl">
        <WorkspaceSettingsForm
          submitLabel="Créer le workspace"
          onSubmit={async (input) => {
            const created = await createWorkspace(input)
            toast.success('Workspace créé.')
            void navigate(`/admin/workspaces/${created.id}`)
          }}
        />
      </div>
    </>
  )
}
