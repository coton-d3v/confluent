import { describeConstraints, type QuestionnaireField, type QuestionnaireSection } from '@confluent/shared'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

// Typed text inputs: the right keyboard on mobile and the browser's own date picker.
const INPUT_TYPE: Partial<Record<QuestionnaireField['fieldType'], string>> = {
  email: 'email',
  date: 'date',
}

// A workspace's complementary form on one page (E05.09): these forms are short, and every answer is
// saved with the same rules as the profile's (checked again by the API).
export function CandidatureFormFields({
  sections,
  fields,
  values,
  errors,
  disabled,
  onChange,
}: {
  sections: QuestionnaireSection[]
  fields: QuestionnaireField[]
  values: Readonly<Record<string, string>>
  errors: Readonly<Record<string, string>>
  disabled: boolean
  onChange: (fieldId: string, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <fieldset key={section.id} className="flex min-w-0 flex-col gap-5">
          <legend className="font-heading text-base font-semibold text-foreground">
            {section.title}
          </legend>
          {fields
            .filter((f) => f.sectionId === section.id)
            .map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={values[field.id] ?? ''}
                error={errors[field.id]}
                disabled={disabled}
                onChange={(value) => onChange(field.id, value)}
              />
            ))}
        </fieldset>
      ))}
    </div>
  )
}

function FieldInput({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: QuestionnaireField
  value: string
  error: string | undefined
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = `candidature-field-${field.id}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const limits = describeConstraints(field)
  const describedBy = [field.helpText || limits ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')
  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    'aria-required': field.required || undefined,
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {field.label}
        {!field.required && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">(facultatif)</span>
        )}
      </label>
      {(field.helpText || limits) && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {[field.helpText, limits].filter(Boolean).join(' · ')}
        </p>
      )}
      {field.fieldType === 'textarea' ? (
        <Textarea {...common} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.fieldType === 'select' || field.fieldType === 'checkbox' ? (
        <NativeSelect {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.fieldType === 'checkbox'
            ? [
                { key: 'true', label: 'Oui' },
                { key: 'false', label: 'Non' },
              ]
            : field.choices
          ).map((choice) => (
            <option key={choice.key} value={choice.key}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          {...common}
          type={INPUT_TYPE[field.fieldType] ?? 'text'}
          inputMode={field.fieldType === 'number' ? 'decimal' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
