import { useEffect } from 'react'
import type { DocumentGroup } from '@confluent/shared'
import { useAsync, type QueryState } from '@/lib/useAsync'
import { listDocuments } from './api'

// Download links are signed for 15 minutes: the list is fetched again before they expire.
const RELIST_EVERY_MS = 10 * 60 * 1000

// Documents of a dossier, as the current user may read them.
export function useDossierDocuments(dossierId: string): QueryState<DocumentGroup[]> {
  const documents = useAsync(() => listDocuments(dossierId), [dossierId])
  const { refetch } = documents
  useEffect(() => {
    const timer = window.setInterval(refetch, RELIST_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [refetch])
  return documents
}

// File names answering each attachment field (E03.11).
export function filenamesByField(groups: readonly DocumentGroup[] | undefined): Map<string, string[]> {
  const byField = new Map<string, string[]>()
  for (const group of groups ?? []) {
    if (!group.fieldId) continue
    byField.set(group.fieldId, [...(byField.get(group.fieldId) ?? []), group.filename])
  }
  return byField
}
