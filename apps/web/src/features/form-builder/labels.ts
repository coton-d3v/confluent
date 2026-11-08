import type { AccessLevel, FieldType, QuestionnaireVersionStatus } from '@confluent/shared'

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texte court',
  textarea: 'Texte long',
  email: 'Email',
  number: 'Nombre',
  date: 'Date',
  select: 'Liste de choix',
  checkbox: 'Case à cocher',
  file: 'Pièce jointe',
}

// Who can read a field's answers through a share (E03.07).
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  public: 'Public — tout partage',
  partiel: 'Partiel — partage partiel ou complet',
  complet: 'Complet — partage complet uniquement',
}

export const VERSION_STATUS_LABELS: Record<QuestionnaireVersionStatus, string> = {
  draft: 'Brouillon',
  published: 'Publiée',
  archived: 'Archivée',
}

export const USAGE_LABELS: Record<string, string> = {
  dossier: 'Formulaire des dossiers',
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
