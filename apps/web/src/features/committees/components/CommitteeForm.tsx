import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  COMMITTEE_LIMITS,
  createCommitteeSchema,
  type Committee,
  type CreateCommitteeInput,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api-client'
import { COMMON_TIME_ZONES, browserTimeZone, otherTimeZones } from '../format'

type FieldName = 'name' | 'date' | 'time' | 'timeZone' | 'location' | 'meetingUrl' | 'internalNotes'
type Values = Record<FieldName, string>
type Errors = Partial<Record<FieldName, string>>

const FIELDS: FieldName[] = [
  'name',
  'date',
  'time',
  'timeZone',
  'location',
  'meetingUrl',
  'internalNotes',
]
const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

function valuesOf(committee?: Committee): Values {
  const zone = browserTimeZone()
  return {
    name: committee?.name ?? '',
    date: committee?.date ?? '',
    time: committee?.time ?? '',
    // A new committee starts in the manager's own zone.
    timeZone: committee?.timeZone ?? zone ?? 'Europe/Paris',
    location: committee?.location ?? '',
    meetingUrl: committee?.meetingUrl ?? '',
    internalNotes: committee?.internalNotes ?? '',
  }
}

// A committee as its managers plan or edit it (ROADMAP E08.01): name, date and time in a named time
// zone, place and/or link, internal information. Checked here with the API's own rules for
// immediate feedback — a time skipped or repeated by a change of offset included —; the API stays
// authoritative and its field errors are shown the same way.
export function CommitteeForm({
  committee,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  // Absent: a new committee.
  committee?: Committee
  submitLabel: string
  // Throws the ApiError of a refusal; field errors are shown next to their field, others above the
  // buttons.
  onSubmit: (input: CreateCommitteeInput) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<Values>(() => valuesOf(committee))
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const others = useMemo(() => otherTimeZones(), [])
  // The committee's own zone stays offered even if this browser does not know it.
  const known = COMMON_TIME_ZONES.includes(values.timeZone) || others.includes(values.timeZone)

  function set(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      // The schedule is checked as a whole.
      ...(field === 'date' || field === 'timeZone' ? { time: undefined } : {}),
    }))
    setFailure(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFailure(null)
    const parsed = createCommitteeSchema.safeParse(values)
    if (!parsed.success) {
      const found: Errors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (isField(field)) found[field] ??= issue.message
      }
      setErrors(found)
      focusFirstError(found)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(parsed.data)
    } catch (err) {
      const found = fieldErrorsOf(err as ApiError)
      if (Object.keys(found).length > 0) {
        setErrors(found)
        focusFirstError(found)
      } else {
        setFailure((err as ApiError)?.message ?? 'Enregistrement impossible. Réessayez plus tard.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <Field id="name" label="Nom du comité" required error={errors.name}>
        <Input
          id="committee-name"
          value={values.name}
          maxLength={COMMITTEE_LIMITS.name}
          onChange={(e) => set('name', e.target.value)}
          {...invalid('name', errors)}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Date et heure</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="date" label="Date" required error={errors.date}>
            <Input
              id="committee-date"
              type="date"
              value={values.date}
              min={`${COMMITTEE_LIMITS.firstYear}-01-01`}
              max={`${COMMITTEE_LIMITS.lastYear}-12-31`}
              onChange={(e) => set('date', e.target.value)}
              {...invalid('date', errors)}
            />
          </Field>
          <Field id="time" label="Heure de début" required error={errors.time}>
            <Input
              id="committee-time"
              type="time"
              value={values.time}
              onChange={(e) => set('time', e.target.value)}
              {...invalid('time', errors)}
            />
          </Field>
        </div>
        <Field
          id="timeZone"
          label="Fuseau horaire"
          required
          error={errors.timeZone}
          help="L’heure ci-dessus est celle de ce fuseau : le comité est affiché à cette heure, fuseau nommé, pour tous les lecteurs."
        >
          <NativeSelect
            id="committee-timeZone"
            value={values.timeZone}
            onChange={(e) => set('timeZone', e.target.value)}
            {...invalid('timeZone', errors)}
          >
            {!known && (
              <option value={values.timeZone}>{values.timeZone.replace(/_/g, ' ')}</option>
            )}
            <optgroup label="France et voisins">
              {COMMON_TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </optgroup>
            {others.length > 0 && (
              <optgroup label="Autres fuseaux">
                {others.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, ' ')}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
        </Field>
      </fieldset>

      <Field
        id="location"
        label="Lieu"
        error={errors.location}
        help="Adresse ou salle, sur une ligne. Laissez vide si le lieu reste à préciser."
      >
        <Input
          id="committee-location"
          value={values.location}
          maxLength={COMMITTEE_LIMITS.location}
          autoComplete="off"
          onChange={(e) => set('location', e.target.value)}
          {...invalid('location', errors)}
        />
      </Field>

      <Field
        id="meetingUrl"
        label="Lien de visioconférence"
        error={errors.meetingUrl}
        help="Adresse complète en https://, si le comité se tient (aussi) en ligne."
      >
        <Input
          id="committee-meetingUrl"
          type="url"
          inputMode="url"
          value={values.meetingUrl}
          maxLength={COMMITTEE_LIMITS.meetingUrl}
          autoComplete="off"
          placeholder="https://"
          onChange={(e) => set('meetingUrl', e.target.value)}
          {...invalid('meetingUrl', errors)}
        />
      </Field>

      <Field
        id="internalNotes"
        label="Informations utiles (internes)"
        error={errors.internalNotes}
        help="Visibles des seuls conseillers de ce workspace et des administrateurs de Confluent : ni des candidats, ni des investisseurs. Texte simple."
      >
        <Textarea
          id="committee-internalNotes"
          rows={5}
          value={values.internalNotes}
          maxLength={COMMITTEE_LIMITS.internalNotes}
          onChange={(e) => set('internalNotes', e.target.value)}
          {...invalid('internalNotes', errors)}
        />
      </Field>

      <div aria-live="assertive">
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Enregistrement…' : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
          Abandonner
        </Button>
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  required,
  help,
  error,
  children,
}: {
  id: FieldName
  label: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`committee-${id}`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children}
      {help && (
        <p id={`committee-${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <div aria-live="assertive">
        {error && (
          <p id={`committee-${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function invalid(field: FieldName, errors: Errors) {
  const error = errors[field]
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error
      ? `committee-${field}-error committee-${field}-help`
      : `committee-${field}-help`,
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`committee-${first}`)?.focus()
}

// Field errors of an API refusal (validation details, the schedule included).
function fieldErrorsOf(err: ApiError | undefined): Errors {
  const found: Errors = {}
  if (err?.status === 400 && Array.isArray(err.details)) {
    for (const detail of err.details as Array<{ path?: unknown[]; message?: string }>) {
      const field = detail.path?.[0]
      if (isField(field) && detail.message) found[field] ??= detail.message
    }
  }
  return found
}
