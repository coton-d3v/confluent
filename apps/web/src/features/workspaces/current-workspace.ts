import { useMatch } from 'react-router-dom'
import type { MyWorkspaceMembership } from '@confluent/shared'

// The workspace a person last entered, remembered in this browser per account (E05.03). It only
// preselects the workspace switcher: it is never an authorization — the API checks the membership
// at each request. Storage may be unavailable (private mode, blocked): then nothing is remembered.
const keyFor = (userId: string) => `confluent.currentWorkspace.${userId}`

export function rememberedWorkspaceId(userId: string): string | null {
  try {
    return localStorage.getItem(keyFor(userId))
  } catch {
    return null
  }
}

export function rememberWorkspace(userId: string, workspaceId: string): void {
  try {
    localStorage.setItem(keyFor(userId), workspaceId)
  } catch {
    // Not remembered: the switcher simply starts without a choice next time.
  }
}

export function forgetWorkspace(userId: string, workspaceId: string): void {
  try {
    if (localStorage.getItem(keyFor(userId)) === workspaceId)
      localStorage.removeItem(keyFor(userId))
  } catch {
    // Nothing remembered to forget.
  }
}

// The workspace the person is in: the one of the page (its space or its management pages), else the
// one last entered — provided it is still among their active memberships.
export function useCurrentWorkspaceId(
  userId: string,
  memberships: MyWorkspaceMembership[],
): string | null {
  const space = useMatch('/workspaces/:workspaceId')?.params.workspaceId
  const managed = useMatch('/admin/workspaces/:workspaceId/*')?.params.workspaceId
  const isMembership = (id: string | null | undefined): id is string =>
    !!id && memberships.some((m) => m.workspace.id === id)
  const fromPage = space ?? managed
  if (fromPage) return isMembership(fromPage) ? fromPage : null
  const remembered = rememberedWorkspaceId(userId)
  return isMembership(remembered) ? remembered : null
}
