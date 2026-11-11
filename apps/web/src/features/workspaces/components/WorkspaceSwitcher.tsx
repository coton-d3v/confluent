import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { NativeSelect } from '@/components/ui/native-select'
import { useCurrentUser } from '@/features/current-user/context'
import { rememberWorkspace, useCurrentWorkspaceId } from '../current-workspace'
import { useWorkspaceMemberships } from '../memberships-context'
import { cn } from '@/lib/utils'

// Switching workspace (E05.03), for an account that belongs to at least one: choosing one opens it
// and remembers it in this browser. Nothing more — each page asks the API, which checks the
// membership again.
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const me = useCurrentUser()
  const { memberships } = useWorkspaceMemberships()
  const current = useCurrentWorkspaceId(me.id, memberships)
  const navigate = useNavigate()
  const id = useId()
  if (memberships.length === 0) return null
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Workspace
      </label>
      <NativeSelect
        id={id}
        value={current ?? ''}
        className="h-11 bg-background lg:h-9"
        onChange={(e) => {
          const workspaceId = e.target.value
          if (!workspaceId) return
          rememberWorkspace(me.id, workspaceId)
          navigate(`/workspaces/${workspaceId}`)
        }}
      >
        {current === null && (
          <option value="" disabled>
            Choisir un workspace…
          </option>
        )}
        {memberships.map((m) => (
          <option key={m.workspace.id} value={m.workspace.id}>
            {m.workspace.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}
