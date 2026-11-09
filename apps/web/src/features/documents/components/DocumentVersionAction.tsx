import type { DocumentVersion } from '@confluent/shared'
import { Button } from '@/components/ui/button'

// Download link of an available version; otherwise why it cannot be downloaded, with the way out.
export function DocumentVersionAction({
  version,
  filename,
  onRetry,
  onReplace,
}: {
  version: DocumentVersion
  filename: string
  onRetry: () => void
  onReplace?: () => void
}) {
  if (version.availability === 'available' && version.url) {
    return (
      <a
        href={version.url}
        className="shrink-0 text-sm font-medium text-foreground underline underline-offset-4"
        aria-label={`Télécharger ${filename}, version ${version.version}`}
      >
        Télécharger
      </a>
    )
  }
  if (version.availability === 'missing') {
    return (
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-medium text-destructive">Fichier perdu</span>
        {onReplace && (
          <Button type="button" size="sm" variant="outline" onClick={onReplace}>
            Redéposer
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="text-xs text-muted-foreground">Momentanément indisponible</span>
      <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}
