import type {
  CreateCandidatureNoteInput,
  InterventionJournal,
  UpdateCandidatureNoteInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E06.08: the internal notes of a workspace on a candidature it received, and the journal of
// its interventions on it — for the workspace's conseillers only; the API decides at each call. Every
// write answers with the journal as it now stands.

const id = encodeURIComponent
const base = (workspaceId: string, candidatureId: string) =>
  `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}`

export const getInterventionJournal = (workspaceId: string, candidatureId: string) =>
  apiRequest<InterventionJournal>(`${base(workspaceId, candidatureId)}/interventions`)

export const createCandidatureNote = (
  workspaceId: string,
  candidatureId: string,
  input: CreateCandidatureNoteInput,
) =>
  apiRequest<InterventionJournal>(`${base(workspaceId, candidatureId)}/notes`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

// From the version of the note the client saw: a note changed or deleted meanwhile is refused (409).
export const updateCandidatureNote = (
  workspaceId: string,
  candidatureId: string,
  noteId: string,
  input: UpdateCandidatureNoteInput,
) =>
  apiRequest<InterventionJournal>(`${base(workspaceId, candidatureId)}/notes/${id(noteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const deleteCandidatureNote = (
  workspaceId: string,
  candidatureId: string,
  noteId: string,
  version: number,
) =>
  apiRequest<InterventionJournal>(
    `${base(workspaceId, candidatureId)}/notes/${id(noteId)}?version=${version}`,
    { method: 'DELETE' },
  )
