import type { SaveStatus } from '../useAnswerAutosave'

const LABELS: Record<SaveStatus, string> = {
  saved: 'Réponses enregistrées',
  pending: 'Modifications en attente d’enregistrement…',
  saving: 'Enregistrement…',
  failed: 'Échec de l’enregistrement',
}

// Where the answers stand (code review U11), announced politely to screen readers.
export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <p role="status" aria-live="polite" className="mt-3 text-right text-xs text-muted-foreground">
      {LABELS[status]}
    </p>
  )
}
