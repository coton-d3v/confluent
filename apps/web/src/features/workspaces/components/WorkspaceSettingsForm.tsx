import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  HEX_COLOR_PATTERN,
  WORKSPACE_LIMITS,
  createWorkspaceSchema,
  type CreateWorkspaceInput,
  type Workspace,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError } from '@/lib/api-client'
import { slugify } from '@/lib/slugify'

type FieldName =
  | 'name'
  | 'slug'
  | 'programName'
  | 'color'
  | 'presentation'
  | 'contactEmail'
  | 'emailDomain'
type Values = Record<FieldName, string>
type Errors = Partial<Record<FieldName, string>>

const FIELDS: FieldName[] = [
  'name',
  'slug',
  'programName',
  'color',
  'presentation',
  'contactEmail',
  'emailDomain',
]

function valuesOf(workspace?: Workspace): Values {
  return {
    name: workspace?.name ?? '',
    slug: workspace?.slug ?? '',
    programName: workspace?.programName ?? '',
    color: workspace?.color ?? '',
    presentation: workspace?.presentation ?? '',
    contactEmail: workspace?.contactEmail ?? '',
    emailDomain: workspace?.emailDomain ?? '',
  }
}

// Same derivation as the API's when no slug is given.
const slugFromName = (name: string) =>
  slugify(name).slice(0, WORKSPACE_LIMITS.slugMax).replace(/-+$/, '')

const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

// Settings of a workspace, for its creation (slug chosen once) or its edition (slug shown, fixed).
// Checked here with the API's own rules for immediate feedback; the API stays authoritative and its
// field errors are shown the same way.
export function WorkspaceSettingsForm({
  workspace,
  submitLabel,
  onSubmit,
}: {
  // Absent: creation.
  workspace?: Workspace
  submitLabel: string
  // Throws the ApiError of a refusal; the form shows it next to the field concerned.
  onSubmit: (input: CreateWorkspaceInput) => Promise<void>
}) {
  const creating = workspace === undefined
  const [values, setValues] = useState<Values>(() => valuesOf(workspace))
  const [slugEdited, setSlugEdited] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)

  function set(field: FieldName, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value }
      if (creating && field === 'name' && !slugEdited) next.slug = slugFromName(value)
      return next
    })
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const { slug, ...settings } = values
    const parsed = createWorkspaceSchema.safeParse(creating ? { ...settings, slug } : settings)
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
        toast.error((err as ApiError)?.message ?? 'Enregistrement impossible.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const colorValid = HEX_COLOR_PATTERN.test(values.color.trim().toLowerCase())

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <Field
        id="name"
        label="Nom de la structure"
        required
        error={errors.name}
        help="Par exemple « CCI Touraine » ou « Réseau Entreprendre Val de Loire »."
      >
        <Input
          id="ws-name"
          value={values.name}
          maxLength={WORKSPACE_LIMITS.name}
          autoComplete="organization"
          onChange={(e) => set('name', e.target.value)}
          {...invalid('name', errors)}
        />
      </Field>

      {creating ? (
        <Field
          id="slug"
          label="Slug"
          error={errors.slug}
          help="Identifiant de l’adresse publique du workspace (/w/…) : minuscules, chiffres et tirets. Il ne pourra plus être modifié."
        >
          <Input
            id="ws-slug"
            value={values.slug}
            maxLength={WORKSPACE_LIMITS.slugMax}
            spellCheck={false}
            autoCapitalize="none"
            className="font-mono"
            onChange={(e) => {
              setSlugEdited(true)
              set('slug', e.target.value)
            }}
            {...invalid('slug', errors)}
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Slug</span>
          <p className="break-all font-mono text-sm text-foreground">{workspace.slug}</p>
          <p className="text-xs text-muted-foreground">
            Fixé à la création : l’adresse publique du workspace ne change pas.
          </p>
        </div>
      )}

      <Field
        id="programName"
        label="Nom du programme"
        error={errors.programName}
        help="Facultatif. Nom sous lequel la structure présente son programme, par exemple « MoneyPlace »."
      >
        <Input
          id="ws-programName"
          value={values.programName}
          maxLength={WORKSPACE_LIMITS.programName}
          onChange={(e) => set('programName', e.target.value)}
          {...invalid('programName', errors)}
        />
      </Field>

      <Field
        id="color"
        label="Couleur"
        error={errors.color}
        help="Facultatif. Couleur principale de la structure, au format #RRGGBB."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Choisir la couleur"
            value={colorValid ? values.color.trim().toLowerCase() : '#1d4ed8'}
            onChange={(e) => set('color', e.target.value)}
            className={
              'h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1' +
              (colorValid ? '' : ' opacity-40')
            }
          />
          <Input
            id="ws-color"
            value={values.color}
            placeholder="#1d4ed8"
            maxLength={7}
            spellCheck={false}
            autoCapitalize="none"
            className="w-32 font-mono"
            onChange={(e) => set('color', e.target.value)}
            {...invalid('color', errors)}
          />
          {values.color !== '' && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('color', '')}>
              Aucune couleur
            </Button>
          )}
        </div>
      </Field>

      <Field
        id="presentation"
        label="Présentation"
        error={errors.presentation}
        help={`Facultatif. Texte simple, retours à la ligne conservés, sans mise en forme ni HTML. ${values.presentation.length} / ${WORKSPACE_LIMITS.presentation} caractères.`}
      >
        <Textarea
          id="ws-presentation"
          rows={6}
          value={values.presentation}
          maxLength={WORKSPACE_LIMITS.presentation}
          onChange={(e) => set('presentation', e.target.value)}
          {...invalid('presentation', errors)}
        />
      </Field>

      <Field
        id="contactEmail"
        label="Email de contact"
        error={errors.contactEmail}
        help="Facultatif. Adresse à laquelle joindre la structure."
      >
        <Input
          id="ws-contactEmail"
          type="email"
          value={values.contactEmail}
          maxLength={254}
          autoComplete="email"
          onChange={(e) => set('contactEmail', e.target.value)}
          {...invalid('contactEmail', errors)}
        />
      </Field>

      <Field
        id="emailDomain"
        label="Domaine email autorisé"
        error={errors.emailDomain}
        help="Facultatif. Par exemple cci-touraine.fr : les membres invités dans ce workspace devront avoir une adresse de ce domaine. Sans effet tant que l’invitation de membres n’est pas disponible."
      >
        <Input
          id="ws-emailDomain"
          value={values.emailDomain}
          placeholder="cci-touraine.fr"
          maxLength={253}
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono"
          onChange={(e) => set('emailDomain', e.target.value)}
          {...invalid('emailDomain', errors)}
        />
      </Field>

      <div>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Enregistrement…' : submitLabel}
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`ws-${id}`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children}
      {help && (
        <p id={`ws-${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <div aria-live="assertive">
        {error && (
          <p id={`ws-${id}-error`} className="text-xs text-destructive">
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
    'aria-describedby': error ? `ws-${field}-error ws-${field}-help` : `ws-${field}-help`,
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`ws-${first}`)?.focus()
}

// Field errors of an API refusal: validation details, or the slug already taken (409).
function fieldErrorsOf(err: ApiError | undefined): Errors {
  if (!err) return {}
  if (err.status === 409) return { slug: err.message }
  const found: Errors = {}
  if (err.status === 400 && Array.isArray(err.details)) {
    for (const detail of err.details as Array<{ path?: unknown[]; message?: string }>) {
      const field = detail.path?.[0]
      if (isField(field) && detail.message) found[field] ??= detail.message
    }
  }
  if (err.status === 400 && /slug/i.test(err.message) && Object.keys(found).length === 0) {
    return { slug: err.message }
  }
  return found
}
