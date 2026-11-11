import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from '@confluent/shared'
import { apiRequest, apiUpload } from '@/lib/api-client'

// Workspaces and their settings (ROADMAP E05.01). Every call returns the workspace as stored.

const BASE = '/v1/admin/workspaces'
const workspace = (id: string) => `${BASE}/${encodeURIComponent(id)}`
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

export const listWorkspaces = () => apiRequest<Workspace[]>(BASE)

export const getWorkspace = (id: string) => apiRequest<Workspace>(workspace(id))

export const createWorkspace = (input: CreateWorkspaceInput) =>
  apiRequest<Workspace>(BASE, json('POST', input))

export const updateWorkspace = (id: string, input: UpdateWorkspaceInput) =>
  apiRequest<Workspace>(workspace(id), json('PATCH', input))

export function uploadWorkspaceLogo(id: string, file: File): Promise<Workspace> {
  const body = new FormData()
  body.append('file', file)
  return apiUpload<Workspace>(`${workspace(id)}/logo`, body)
}

export const removeWorkspaceLogo = (id: string) =>
  apiRequest<Workspace>(`${workspace(id)}/logo`, { method: 'DELETE' })
