import type { MyWorkspaceMembership } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// The signed-in person's active workspace memberships (ROADMAP E05.02).
export const listMyWorkspaceMemberships = () =>
  apiRequest<MyWorkspaceMembership[]>('/v1/workspaces/memberships')
