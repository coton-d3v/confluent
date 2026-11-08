import type { DraftProblem } from '@confluent/shared'

// What still prevents publication, as computed by the API.
export function DraftProblems({ problems }: { problems: DraftProblem[] }) {
  if (problems.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Le brouillon est prêt à être publié.
      </p>
    )
  }
  return (
    <div
      role="status"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <p className="font-medium text-foreground">Avant de publier :</p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {problems.map((p) => (
          <li key={`${p.code}-${p.sectionId ?? ''}-${p.fieldId ?? ''}`}>{p.message}</li>
        ))}
      </ul>
    </div>
  )
}
