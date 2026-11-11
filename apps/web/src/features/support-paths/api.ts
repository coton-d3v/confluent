import type {
  CandidatureSupportPath,
  CreateSupportStepInput,
  ReceivedSupportPath,
  SupportStep,
  UpdateSupportStepInput,
} from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E06.06: a workspace's support path — read by its conseillers, configured by its managers —
// and a candidature's path: read by its owner, validated by the workspace. The API decides at each
// call who reads and writes what.

const id = encodeURIComponent
const managed = (workspaceId: string) => `/v1/admin/workspaces/${id(workspaceId)}/support-steps`

export const listSupportSteps = (workspaceId: string) =>
  apiRequest<SupportStep[]>(`/v1/workspaces/${id(workspaceId)}/support-steps`)

export const createSupportStep = (workspaceId: string, input: CreateSupportStepInput) =>
  apiRequest<SupportStep>(managed(workspaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateSupportStep = (
  workspaceId: string,
  stepId: string,
  input: UpdateSupportStepInput,
) =>
  apiRequest<SupportStep>(`${managed(workspaceId)}/${id(stepId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const reorderSupportSteps = (workspaceId: string, stepIds: string[]) =>
  apiRequest<SupportStep[]>(`${managed(workspaceId)}/order`, {
    method: 'PUT',
    body: JSON.stringify({ stepIds }),
  })

// The owner's view of a candidature's path (a draft included): when a step was validated, never by
// whom.
export const getSupportPath = (candidatureId: string) =>
  apiRequest<CandidatureSupportPath>(`/v1/candidatures/${id(candidatureId)}/support-path`)

const receivedPath = (workspaceId: string, candidatureId: string) =>
  `/v1/workspaces/${id(workspaceId)}/candidatures/${id(candidatureId)}/support-path`

// The workspace's view: validators and history too.
export const getReceivedSupportPath = (workspaceId: string, candidatureId: string) =>
  apiRequest<ReceivedSupportPath>(receivedPath(workspaceId, candidatureId))

// From the version of the step the client saw (`0`: never validated): a step changed meanwhile is
// refused (409).
export const setSupportStepValidation = (
  workspaceId: string,
  candidatureId: string,
  stepId: string,
  input: { validated: boolean; version: number },
) =>
  apiRequest<ReceivedSupportPath>(
    `${receivedPath(workspaceId, candidatureId)}/steps/${id(stepId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
