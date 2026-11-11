import { Badge } from '@/components/ui/badge'
import { financingTypeLabels, formatAmount, type PresentationData } from '../presentation'

// The presentation of a financing request (E05.07), read-only, as plain text (line breaks kept,
// never interpreted as HTML). The API sends it to a share recipient once the request is published.
export function RequestPresentation({ dossier }: { dossier: PresentationData }) {
  const amount = formatAmount(dossier.amountEur)
  const types = financingTypeLabels(dossier.financingTypes)
  return (
    <div className="flex flex-col gap-4">
      {dossier.summary && (
        <p className="whitespace-pre-line break-words text-base text-foreground">{dossier.summary}</p>
      )}
      {(amount || types.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {amount && (
            <span className="text-lg font-semibold text-foreground">
              <span className="sr-only">Montant recherché : </span>
              {amount}
            </span>
          )}
          {types.length > 0 && (
            <ul role="list" aria-label="Types de financement" className="flex flex-wrap gap-2">
              {types.map((label) => (
                <li key={label}>
                  <Badge variant="outline">{label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dossier.objective && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Objectif du financement</h3>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">
            {dossier.objective}
          </p>
        </div>
      )}
      {dossier.description && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">
            {dossier.description}
          </p>
        </div>
      )}
    </div>
  )
}
