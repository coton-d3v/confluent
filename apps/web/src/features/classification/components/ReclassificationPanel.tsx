import { useState } from 'react'
import { toast } from 'sonner'
import type { ReclassificationPreview } from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { applyReclassification, previewReclassification } from '@/features/admin/classification.api'
import { COLUMN_LABELS, displayResultValue } from '../labels'
import { errorMessage } from '../useClassificationAdmin'

// Rules never rewrite submitted dossiers by themselves (E03.12): preview, then apply explicitly.
export function ReclassificationPanel({ onConfirm }: { onConfirm: (apply: () => void, count: number) => void }) {
  const [preview, setPreview] = useState<ReclassificationPreview | null>(null)
  const [working, setWorking] = useState(false)

  async function check() {
    setWorking(true)
    try {
      setPreview(await previewReclassification())
    } catch (err) {
      toast.error(errorMessage(err, 'Vérification impossible.'))
    } finally {
      setWorking(false)
    }
  }

  async function apply() {
    setWorking(true)
    try {
      const applied = await applyReclassification()
      toast.success(`${applied.dossiers.length} dossier(s) reclassé(s).`)
      setPreview(await previewReclassification())
    } catch (err) {
      toast.error(errorMessage(err, 'Reclassement impossible.'))
    } finally {
      setWorking(false)
    }
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
          Vérifier l’effet des règles
        </Button>
        {preview && preview.dossiers.length > 0 && (
          <Button type="button" size="sm" disabled={working} onClick={() => onConfirm(() => void apply(), preview.dossiers.length)}>
            Reclasser {preview.dossiers.length} dossier(s)
          </Button>
        )}
      </div>
      {preview && (
        <div role="status" className="rounded-md border border-border bg-card px-4 py-3 text-sm">
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
