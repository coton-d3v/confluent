import type { AnswerInput, AnswerRow, ConfirmAnswerInput } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

export function listAnswers(dossierId: string): Promise<AnswerRow[]> {
  return apiRequest<AnswerRow[]>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/answers`,
  )
}

export function upsertAnswers(
  dossierId: string,
  answers: AnswerInput[],
): Promise<AnswerRow[]> {
  return apiRequest<AnswerRow[]>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/answers`,
    {
      method: 'PUT',
      body: JSON.stringify({ answers }),
    },
  )
}

// Confirms an AI proposal as it was shown (E04.05): refused (409) if it changed since.
export function confirmAnswer(
  dossierId: string,
  fieldId: string,
  shown: ConfirmAnswerInput,
): Promise<AnswerRow> {
  return apiRequest<AnswerRow>(
    `/v1/dossiers/${encodeURIComponent(dossierId)}/answers/${encodeURIComponent(fieldId)}/confirm`,
    { method: 'POST', body: JSON.stringify(shown) },
  )
}
