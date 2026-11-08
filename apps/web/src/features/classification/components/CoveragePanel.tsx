import { CLASSIFICATION_DIMENSIONS, type ClassificationCoverage, type CoverageIssue } from '@confluent/shared'
import { Button } from '@/components/ui/button'

const STATUS: Record<string, string> = { published: 'publiée', draft: 'brouillon' }

// Gaps between the rules and the dossier form (E03.12): checked after every form change.
export function CoveragePanel({
  coverage,
  onFix,
}: {
  coverage: ClassificationCoverage
  onFix: (issue: CoverageIssue) => void
}) {
  if (coverage.versions.length === 0) return null
  return (
    <section aria-labelledby="coverage-title" className="flex flex-col gap-3">
      <h2 id="coverage-title" className="font-heading text-lg font-semibold text-foreground">
        Contrôle du formulaire des dossiers
      </h2>
      {coverage.versions.map((v) => (
        <div
          key={v.versionId}
          role="status"
          className={
            v.issues.some((i) => i.kind === 'unmapped_choice')
              ? 'rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm'
              : 'rounded-md border border-border bg-muted/40 px-4 py-3 text-sm'
          }
        >
          <p className="font-medium text-foreground">
            Version {v.version} ({STATUS[v.status] ?? v.status}) :{' '}
            {v.issues.length === 0 ? 'toutes les règles correspondent.' : `${v.issues.length} écart(s)`}
          </p>
          {v.issues.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {v.issues.map((issue) => (
                <li
                  key={`${issue.kind}-${issue.dimension}-${issue.fieldKey}-${issue.choiceKey}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
                >
                  <span>{issue.message}</span>
                  {issue.kind === 'unmapped_choice' && CLASSIFICATION_DIMENSIONS[issue.dimension].kind === 'choice' && (
                    <Button type="button" variant="outline" size="xs" onClick={() => onFix(issue)}>
                      Ajouter une règle
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Un champ absent d’une version peut rester utile : les dossiers créés avec une version plus ancienne le
        lisent encore.
      </p>
    </section>
  )
}
