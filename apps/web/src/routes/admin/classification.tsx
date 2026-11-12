import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { ClassificationDimensionKey, CoverageIssue } from '@confluent/shared'
import { ConfirmDialog, type ConfirmRequest } from '@/components/confluent/ConfirmDialog'
import { LoadError } from '@/components/confluent/LoadError'
import { Button } from '@/components/ui/button'
import { useCurrentUser } from '@/features/current-user/context'
import { createRule, deleteRule, updateRule } from '@/features/admin/classification.api'
import { adminFailure } from '@/features/admin/failure'
import { CoveragePanel } from '@/features/classification/components/CoveragePanel'
import { DimensionSection, type RuleDraft } from '@/features/classification/components/DimensionSection'
import { ReclassificationPanel } from '@/features/classification/components/ReclassificationPanel'
import { DIMENSION_KEYS, formLabels } from '@/features/classification/labels'
import { useClassificationAdmin } from '@/features/classification/useClassificationAdmin'

export default function AdminClassificationRoute() {
  const me = useCurrentUser()
  if (me.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <ClassificationAdmin />
}

// Classification rules (ROADMAP E03.12).
function ClassificationAdmin() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { data, loadError, stale, busy, run, refresh } = useClassificationAdmin()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [prefill, setPrefill] = useState<{ dimension: ClassificationDimensionKey; draft: RuleDraft } | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const labels = data ? formLabels(data.fields) : null

  function fix(issue: CoverageIssue) {
    setPrefill({ dimension: issue.dimension, draft: { fieldKey: issue.fieldKey, choiceKey: issue.choiceKey, value: '' } })
    document.getElementById(`dimension-${issue.dimension}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <>
      <title>Classification · Confluent</title>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground md:text-[28px] focus-visible:outline-none"
      >
        Classification
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Les règles relient les réponses aux dimensions du pipeline (secteur, ancrage, axes, profil technologique),
        par clé de champ et de choix : renommer un libellé ne les change pas.
      </p>

      {!data || !labels ? (
        loadError ? (
          <LoadError
            className="mt-8"
            message={adminFailure(loadError, 'La classification n’a pas pu être chargée.')}
            onRetry={() => void refresh()}
          />
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Chargement…</p>
        )
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {stale && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <span>L’affichage n’est peut-être plus à jour.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                Actualiser
              </Button>
            </div>
          )}
          <CoveragePanel coverage={data.coverage} onFix={fix} />
          <div className="flex flex-col gap-4">
            {DIMENSION_KEYS.map((dimension) => (
              <DimensionSection
                key={dimension}
                dimension={dimension}
                rules={data.rules.filter((r) => r.dimension === dimension)}
                labels={labels}
                busy={busy}
                prefill={prefill?.dimension === dimension ? prefill.draft : null}
                onCreate={async (input) => {
                  const ok = await run(() => createRule(input), 'Règle ajoutée.')
                  if (ok) setPrefill(null)
                  return ok
                }}
                onChangeValue={(rule, value) => void run(() => updateRule(rule.id, { value }), 'Règle modifiée.')}
                onRemove={(rule) =>
                  setConfirm({
                    title: 'Retirer cette règle ?',
                    description: 'Les dossiers déjà classés ne changent pas tant qu’ils ne sont pas reclassés.',
                    confirmLabel: 'Retirer',
                    onConfirm: () => void run(() => deleteRule(rule.id), 'Règle retirée.'),
                  })
                }
              />
            ))}
          </div>
          <ReclassificationPanel
            onConfirm={(apply, count) =>
              setConfirm({
                title: `Reclasser ${count} dossier(s) ?`,
                description:
                  'Les valeurs affichées dans le pipeline et aux financeurs seront mises à jour. Chaque changement est tracé dans le journal d’audit.',
                confirmLabel: 'Reclasser',
                onConfirm: apply,
              })
            }
          />
        </div>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}
