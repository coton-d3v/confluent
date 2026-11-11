import { createContext, use } from 'react'
import type { MyWorkspaceMembership } from '@confluent/shared'

interface WorkspaceMemberships {
  memberships: MyWorkspaceMembership[]
  // Reloads them, e.g. when the API says a workspace is no longer open to the person.
  refresh: () => void
}

// The signed-in person's active memberships, loaded once and provided by the application shell.
export const WorkspaceMembershipsContext = createContext<WorkspaceMemberships>({
  memberships: [],
  refresh: () => undefined,
})

export function useWorkspaceMemberships(): WorkspaceMemberships {
  return use(WorkspaceMembershipsContext)
}
