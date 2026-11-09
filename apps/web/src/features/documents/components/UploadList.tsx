import { Button } from '@/components/ui/button'
import type { UploadItem } from '../useDocumentUploads'

// Files being sent (with their progress) and files refused (with the reason, until dismissed).
export function UploadList({
  uploads,
  onDismiss,
}: {
  uploads: UploadItem[]
  onDismiss: (id: number) => void
}) {
  if (uploads.length === 0) return null
  return (
    <ul role="list" className="flex flex-col gap-2">
      {uploads.map((u) => (
        <li key={u.id} className="rounded-lg border border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{u.name}</p>
            {u.error && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDismiss(u.id)}>
                Fermer
              </Button>
            )}
          </div>
          {u.error ? (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {u.error}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <progress
                className="h-2 w-full"
                max={1}
                value={u.progress}
                aria-label={`Envoi de ${u.name}`}
              />
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(u.progress * 100)} %
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
