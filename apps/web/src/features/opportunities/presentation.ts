import { ACCESS_LEVEL_LABELS, type OpportunitySource } from '@confluent/shared'

// « Partagée avec vous · accès public », « Vivier de CCI Touraine · accès partiel ».
export function sourceLabel(source: OpportunitySource): string {
  const level = `accès ${ACCESS_LEVEL_LABELS[source.accessLevel].toLowerCase()}`
  return source.kind === 'share'
    ? `Partagée avec vous · ${level}`
    : `Vivier de ${source.workspace.name} · ${level}`
}
