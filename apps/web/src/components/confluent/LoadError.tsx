import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ROADMAP E10.05: a reading that failed, said where its content would be — what could not be read,
// why when the API said so — with the way to read it again. Shown until a reading succeeds: the
// page's actions that depend on it stay unavailable meanwhile.
export function LoadError({
  message,
  onRetry,
  retrying = false,
  className,
}: {
  message: string
  onRetry: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground',
        className,
      )}
    >
      <p className="min-w-0 flex-1">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Nouvel essai…' : 'Réessayer'}
      </Button>
    </div>
  )
}
