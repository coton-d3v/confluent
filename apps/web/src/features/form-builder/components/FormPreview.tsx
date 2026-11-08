import type { FormVersionStructure } from '@confluent/shared'
import { FIELD_TYPE_LABELS } from '../labels'

// What an entrepreneur will be asked, section by section (E03.03 preview). Nothing is interactive.
export function FormPreview({ structure }: { structure: FormVersionStructure }) {
  return (
    <div className="flex flex-col gap-8">
      {structure.sections.map((section, i) => {
        const fields = structure.fields.filter((f) => f.sectionId === section.id)
        return (
          <section key={section.id}>
            <h3 className="font-heading text-lg font-semibold text-foreground">
              {i + 1}. {section.title}
            </h3>
            <ol className="mt-3 flex flex-col gap-5">
              {fields.map((field) => (
                <li key={field.id} className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-foreground">
                    {field.label}
                    {!field.required && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (facultatif)
                      </span>
                    )}
                  </p>
                  {field.helpText && (
                    <p className="text-xs text-muted-foreground">{field.helpText}</p>
                  )}
                  {field.fieldType === 'select' ? (
                    <ul className="flex flex-col gap-1.5">
                      {field.choices.map((choice) => (
                        <li
                          key={choice.key}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                        >
                          {choice.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      {FIELD_TYPE_LABELS[field.fieldType]}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
