import { useState } from 'react'
import { toast } from 'sonner'
import type { ReclassificationPreview } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { applyReclassification, previewReclassification } from '@/features/admin/classification.api'
import { COLUMN_LABELS, displayResultValue } from '../labels'
import { errorMessage } from '../useClassificationAdmin'

// Rules never rewrite submitted dossiers by themselves (E03.12): preview, then apply explicitly the
// rules of that preview. A reclassification and the preview read after it are told apart (code
// review R45): if the reading fails, the preview is marked out of date and can only be reloaded —
// the reclassification is never run again to refresh the screen.
export function ReclassificationPanel({ onConfirm }: { onConfirm: (apply: () => void, count: number) => void }) {
  const [preview, setPreview] = useState<ReclassificationPreview | null>(null)
  const [stale, setStale] = useState(false)
  const [working, setWorking] = useState(false)

  async function load(): Promise<boolean> {
    try {
      setPreview(await previewReclassification())
      setStale(false)
      return true
    } catch {
      return false
    }
  }

  async function check() {
    setWorking(true)
    if (!(await load())) toast.error('Vérification impossible.')
    setWorking(false)
  }

  async function apply(rulesRevision: string) {
    setWorking(true)
    try {
      const applied = await applyReclassification(rulesRevision)
      toast.success(`${applied.dossiers.length} dossier(s) reclassé(s).`)
    } catch (err) {
      // Nothing was written (e.g. the rules changed since the preview): the preview is out of date.
      toast.error(errorMessage(err, 'Reclassement impossible.'))
      setStale(true)
      setWorking(false)
      return
    }
    if (!(await load())) {
      setStale(true)
      toast.warning('L’aperçu n’a pas pu être actualisé.')
    }
    setWorking(false)
  }

  return (
    <section aria-labelledby="reclassification-title" className="flex flex-col gap-3">
      <h2 id="reclassification-title" className="font-heading text-lg font-semibold text-foreground">
        Dossiers déjà soumis
      </h2>
      <p className="text-sm text-muted-foreground">
        Modifier une règle ne change pas les dossiers déjà classés. Vérifiez l’effet des règles actuelles, puis
        appliquez-le si vous le souhaitez.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => void check()}>
          {stale ? 'Recharger l’aperçu' : 'Vérifier l’effet des règles'}
        </Button>
        {preview && !stale && preview.dossiers.length > 0 && (
          <Button
            type="button"
            size="sm"
            disabled={working}
            onClick={() => onConfirm(() => void apply(preview.rulesRevision), preview.dossiers.length)}
          >
            Reclasser {preview.dossiers.length} dossier(s)
          </Button>
        )}
      </div>
      {preview && stale && (
        <p role="alert" className="text-sm text-destructive">
          Cet aperçu n’est plus à jour : rechargez-le avant de reclasser.
        </p>
      )}
      {preview && (
        <div
          role="status"
          aria-disabled={stale || undefined}
          className={`rounded-md border border-border bg-card px-4 py-3 text-sm ${stale ? 'opacity-50' : ''}`}
        >
          {preview.dossiers.length === 0 ? (
            <p className="text-muted-foreground">
              {preview.checked} dossier(s) soumis vérifié(s) : aucun changement.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {preview.dossiers.map((d) => (
                <li key={d.dossierId}>
                  <p className="font-medium text-foreground">{d.name}</p>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {d.changes.map((c) => (
                      <li key={c.column}>
                        {COLUMN_LABELS[c.column as keyof typeof COLUMN_LABELS] ?? c.column} :{' '}
                        {displayResultValue(c.column, c.from)} → {displayResultValue(c.column, c.to)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
