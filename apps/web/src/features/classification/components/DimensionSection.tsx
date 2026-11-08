import { useState, type FormEvent } from 'react'
import {
  CLASSIFICATION_DIMENSIONS,
  type ClassificationDimensionKey,
  type ClassificationRule,
  type CreateClassificationRuleInput,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { KIND_HELP, valueLabel, type formLabels } from '../labels'

type Labels = ReturnType<typeof formLabels>

export interface RuleDraft {
  fieldKey: string
  choiceKey: string
  value: string
}

// One dimension: its rules (value editable for a `choice` dimension) and a form to add one.
export function DimensionSection({
  dimension,
  rules,
  labels,
  busy,
  prefill,
  onCreate,
  onChangeValue,
  onRemove,
}: {
  dimension: ClassificationDimensionKey
  rules: ClassificationRule[]
  labels: Labels
  busy: boolean
  // Set by « Ajouter une règle » in the coverage panel.
  prefill: RuleDraft | null
  onCreate: (input: CreateClassificationRuleInput) => Promise<boolean>
  onChangeValue: (rule: ClassificationRule, value: string) => void
  onRemove: (rule: ClassificationRule) => void
}) {
  const spec = CLASSIFICATION_DIMENSIONS[dimension]
  const headingId = `dimension-${dimension}`
  const sorted = [...rules].sort((a, b) => a.position - b.position || a.fieldKey.localeCompare(b.fieldKey))
  return (
    <section id={headingId} aria-labelledby={`${headingId}-title`} className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 id={`${headingId}-title`} className="text-sm font-semibold text-foreground">
          {spec.label}
        </h2>
        <p className="text-xs text-muted-foreground">{KIND_HELP[spec.kind]}</p>
      </header>
      {sorted.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Aucune règle.</p>
      ) : (
        <ul role="list" className="m-0 list-none divide-y divide-border p-0">
          {sorted.map((rule, index) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {spec.kind === 'label' && <span className="mr-2 text-xs text-muted-foreground">{index + 1}.</span>}
                  {labels.field(rule.fieldKey) ?? <span className="text-muted-foreground">Champ absent du formulaire</span>}
                  {rule.choiceKey && (
                    <>
                      {' → '}
                      {labels.choice(rule.fieldKey, rule.choiceKey) ?? <span className="text-muted-foreground">choix absent</span>}
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  <code>{rule.fieldKey}</code>
                  {rule.choiceKey && (
                    <>
                      {' · '}
                      <code>{rule.choiceKey}</code>
                    </>
                  )}
                </p>
              </div>
              {spec.kind === 'choice' && (
                <NativeSelect
                  aria-label={`Valeur pour ${labels.choice(rule.fieldKey, rule.choiceKey) ?? rule.choiceKey}`}
                  className="w-auto min-w-40"
                  value={rule.value}
                  disabled={busy}
                  onChange={(e) => onChangeValue(rule, e.target.value)}
                >
                  {spec.values.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(rule)}>
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddRuleForm
        key={prefill ? `${prefill.fieldKey}:${prefill.choiceKey}` : 'empty'}
        dimension={dimension}
        labels={labels}
        busy={busy}
        prefill={prefill}
        nextPosition={sorted.length}
        onCreate={onCreate}
      />
    </section>
  )
}

function AddRuleForm({
  dimension,
  labels,
  busy,
  prefill,
  nextPosition,
  onCreate,
}: {
  dimension: ClassificationDimensionKey
  labels: Labels
  busy: boolean
  prefill: RuleDraft | null
  nextPosition: number
  onCreate: (input: CreateClassificationRuleInput) => Promise<boolean>
}) {
  const spec = CLASSIFICATION_DIMENSIONS[dimension]
  const firstValue: string = spec.values[0]?.value ?? ''
  const [fieldKey, setFieldKey] = useState(prefill?.fieldKey ?? '')
  const [choiceKey, setChoiceKey] = useState(prefill?.choiceKey ?? '')
  const [value, setValue] = useState(prefill?.value || firstValue)
  const fields = spec.kind === 'label' ? labels.allFields : labels.listFields
  const choices = fields.find((f) => f.key === fieldKey)?.choices ?? []
  const complete = fieldKey !== '' && (spec.kind === 'label' || choiceKey !== '')
  const id = (name: string) => `add-${dimension}-${name}`

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!complete) return
    const created = await onCreate({
      dimension,
      fieldKey,
      choiceKey: spec.kind === 'label' ? '' : choiceKey,
      value: spec.kind === 'choice' ? value : '',
      position: spec.kind === 'label' ? nextPosition : 0,
    })
    if (created) {
      setFieldKey('')
      setChoiceKey('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor={id('field')} className="text-xs text-muted-foreground">
          Champ
        </label>
        <NativeSelect
          id={id('field')}
          value={fieldKey}
          onChange={(e) => {
            setFieldKey(e.target.value)
            setChoiceKey('')
          }}
        >
          <option value="">Choisir…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {spec.kind !== 'label' && (
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={id('choice')} className="text-xs text-muted-foreground">
            Choix
          </label>
          <NativeSelect id={id('choice')} value={choiceKey} disabled={!fieldKey} onChange={(e) => setChoiceKey(e.target.value)}>
            <option value="">Choisir…</option>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {spec.kind === 'choice' && (
        <div className="flex min-w-40 flex-col gap-1">
          <label htmlFor={id('value')} className="text-xs text-muted-foreground">
            Valeur
          </label>
          <NativeSelect id={id('value')} value={value} onChange={(e) => setValue(e.target.value)}>
            {spec.values.map((v) => (
              <option key={v.value} value={v.value}>
                {valueLabel(dimension, v.value)}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={busy || !complete}>
        Ajouter la règle
      </Button>
    </form>
  )
}
