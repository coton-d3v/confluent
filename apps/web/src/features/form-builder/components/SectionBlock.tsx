import {
  describeConstraints,
  type QuestionnaireField,
  type QuestionnaireSection,
} from '@confluent/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ACCESS_LEVEL_LABELS, FIELD_TYPE_LABELS } from '../labels'
import { InlineTextEdit } from './InlineTextEdit'

export interface SectionActions {
  rename: (title: string) => Promise<boolean>
  move: (step: -1 | 1) => void
  remove: () => void
  addField: () => void
  editField: (field: QuestionnaireField) => void
  moveField: (field: QuestionnaireField, step: -1 | 1) => void
  removeField: (field: QuestionnaireField) => void
}

// One section of a version. Without `actions`, it is shown read-only (published version).
export function SectionBlock({
  section,
  fields,
  position,
  count,
  busy,
  actions,
}: {
  section: QuestionnaireSection
  fields: QuestionnaireField[]
  position: number
  count: number
  busy: boolean
  actions?: SectionActions
}) {
  const heading = (
    <h3 className="truncate text-sm font-semibold text-foreground">
      {position}. {section.title}
    </h3>
  )
  return (
    <section
      aria-label={`Section ${position} : ${section.title}`}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        {actions ? (
          <InlineTextEdit
            value={section.title}
            label={`titre de la section ${position}`}
            disabled={busy}
            onSave={actions.rename}
          >
            {heading}
          </InlineTextEdit>
        ) : (
          heading
        )}
        {actions && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Monter la section ${section.title}`}
              disabled={busy || position === 1}
              onClick={() => actions.move(-1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Descendre la section ${section.title}`}
              disabled={busy || position === count}
              onClick={() => actions.move(1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={actions.remove}
            >
              Retirer
            </Button>
          </div>
        )}
      </div>

      {fields.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Aucun champ dans cette section.</p>
      ) : (
        <ol className="m-0 list-none divide-y divide-border p-0">
          {fields.map((field, index) => (
            <li key={field.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{field.label}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">{FIELD_TYPE_LABELS[field.fieldType]}</Badge>
                  <Badge variant={field.required ? 'secondary' : 'outline'}>
                    {field.required ? 'Obligatoire' : 'Facultatif'}
                  </Badge>
                  <span>{ACCESS_LEVEL_LABELS[field.minAccessLevel].split(' — ')[0]}</span>
                  <code className="text-[11px]">{field.key}</code>
                </div>
                {describeConstraints(field) && (
                  <p className="mt-1 text-xs text-muted-foreground">{describeConstraints(field)}</p>
                )}
                {field.fieldType === 'select' && field.choices.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {field.choices.map((c) => c.label).join(' · ')}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Monter le champ ${field.label}`}
                    disabled={busy || index === 0}
                    onClick={() => actions.moveField(field, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Descendre le champ ${field.label}`}
                    disabled={busy || index === fields.length - 1}
                    onClick={() => actions.moveField(field, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => actions.editField(field)}
                    aria-label={`Modifier le champ ${field.label}`}
                  >
                    Modifier
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => actions.removeField(field)}
                    aria-label={`Retirer le champ ${field.label}`}
                  >
                    Retirer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {actions && (
        <div className="border-t border-border px-4 py-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={actions.addField}>
            + Ajouter un champ
          </Button>
        </div>
      )}
    </section>
  )
}
