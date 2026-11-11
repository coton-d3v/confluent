import { useState, type FormEvent } from 'react'
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  WORKSPACE_MEMBER_LIMITS,
  WORKSPACE_MEMBER_ROLES,
  WORKSPACE_MEMBER_ROLE_LABELS,
  emailDomainOf,
  inviteWorkspaceMemberSchema,
  updateWorkspaceMemberSchema,
  type InvestorType,
  type InviteWorkspaceMemberInput,
  type UpdateWorkspaceMemberInput,
  type WorkspaceMember,
  type WorkspaceMemberRole,
} from '@confluent/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { ApiError } from '@/lib/api-client'

type FieldName = 'email' | 'role' | 'organization' | 'investorType' | 'canManageWorkspace'
type Errors = Partial<Record<FieldName, string>>
const FIELDS: FieldName[] = ['email', 'role', 'organization', 'investorType', 'canManageWorkspace']
const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

// What the form sends besides the address: what the role cannot hold is left out.
interface MemberFields {
  role: WorkspaceMemberRole
  organization: string
  investorType?: InvestorType | null
  canManageWorkspace?: boolean
}

interface Values {
  email: string
  role: WorkspaceMemberRole
  organization: string
  investorType: string
  canManageWorkspace: boolean
}

type Props = {
  // The workspace's email domain, required of conseillers (null: none).
  emailDomain: string | null
  // Editing one's own membership: say what giving up the right means.
  isSelf?: boolean
  onCancel: () => void
} & (
  | { member?: undefined; onSubmit: (input: InviteWorkspaceMemberInput) => Promise<void> }
  | { member: WorkspaceMember; onSubmit: (input: UpdateWorkspaceMemberInput) => Promise<void> }
)

// Invitation (no `member`) or edition of a member: role, organization, investor type (investisseurs)
// and right to manage the workspace (conseillers). Checked with the API's own rules; the API's
// field errors are shown the same way.
export function WorkspaceMemberForm(props: Props) {
  const { emailDomain, isSelf, onCancel } = props
  const editing = props.member !== undefined
  const [values, setValues] = useState<Values>(() => ({
    email: props.member?.user.email ?? '',
    role: props.member?.role ?? 'conseiller',
    organization: props.member?.organization ?? '',
    investorType: props.member?.investorType ?? '',
    canManageWorkspace: props.member?.canManageWorkspace ?? false,
  }))
  const [errors, setErrors] = useState<Errors>({})
  // A refusal that concerns no field in particular (last manager, rights withdrawn…).
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  function input(): MemberFields {
    return values.role === 'investisseur'
      ? {
          role: values.role,
          organization: values.organization,
          investorType: (values.investorType || null) as InvestorType | null,
        }
      : {
          role: values.role,
          organization: values.organization,
          canManageWorkspace: values.canManageWorkspace,
        }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const found: Errors = {}
    let send: () => Promise<void>
    if (props.member === undefined) {
      const parsed = inviteWorkspaceMemberSchema.safeParse({ email: values.email, ...input() })
      if (!parsed.success) collect(parsed.error.issues, found)
      else if (
        parsed.data.role === 'conseiller' &&
        emailDomain &&
        emailDomainOf(parsed.data.email) !== emailDomain
      ) {
        found.email = `Adresse @${emailDomain} attendue pour un conseiller.`
      }
      const onSubmit = props.onSubmit
      send = () => onSubmit(parsed.data!)
    } else {
      const member = props.member
      const changes = changedFields(member, input())
      if (Object.keys(changes).length === 0) {
        onCancel()
        return
      }
      const parsed = updateWorkspaceMemberSchema.safeParse(changes)
      if (!parsed.success) collect(parsed.error.issues, found)
      const onSubmit = props.onSubmit
      send = () => onSubmit(changes)
    }
    if (Object.keys(found).length > 0) {
      setErrors(found)
      focusFirstError(found)
      return
    }
    setSubmitting(true)
    try {
      await send()
    } catch (err) {
      const apiError = err as ApiError | undefined
      const apiErrors = fieldErrorsOf(apiError, editing)
      if (Object.keys(apiErrors).length > 0) {
        setErrors(apiErrors)
        focusFirstError(apiErrors)
      } else {
        setFormError(apiError?.message || 'Enregistrement impossible.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const givesUpOwnRight =
    isSelf &&
    props.member?.canManageWorkspace === true &&
    (values.role !== 'conseiller' || !values.canManageWorkspace)

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5 px-4 py-3">
      {editing ? (
        // Read only, but the API may still refuse the address (a conseiller outside the workspace's
        // email domain, code review R54): its error is shown and announced here, and focused.
        <div className="flex flex-col gap-1.5">
          <p
            id="member-email"
            tabIndex={-1}
            className="break-all text-sm text-foreground outline-none"
            aria-describedby={errors.email ? 'member-email-error' : undefined}
          >
            {values.email}
          </p>
          <FieldError id="email" error={errors.email} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="member-email">Adresse email</Label>
          <Input
            id="member-email"
            type="email"
            autoFocus
            autoComplete="off"
            placeholder="nom@structure.fr"
            maxLength={WORKSPACE_MEMBER_LIMITS.email}
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            {...describedBy('email', errors)}
          />
          <p id="member-email-help" className="text-xs text-muted-foreground">
            {emailDomain
              ? `Un conseiller doit avoir une adresse @${emailDomain} ; un investisseur, une adresse quelconque.`
              : 'Un compte est créé si l’adresse est inconnue de Confluent.'}
          </p>
          <FieldError id="email" error={errors.email} />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Rôle dans le workspace</legend>
        {WORKSPACE_MEMBER_ROLES.map((role) => (
          <label key={role} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="member-role"
              value={role}
              checked={values.role === role}
              onChange={() => set('role', role)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              {WORKSPACE_MEMBER_ROLE_LABELS[role]}
              <span className="block text-xs text-muted-foreground">
                {role === 'conseiller'
                  ? 'Équipe de la structure ; peut recevoir le droit de gérer le workspace.'
                  : 'Membre de la communauté d’investisseurs de la structure.'}
              </span>
            </span>
          </label>
        ))}
        <FieldError id="role" error={errors.role} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="member-organization">Organisation</Label>
        <Input
          id="member-organization"
          value={values.organization}
          maxLength={WORKSPACE_MEMBER_LIMITS.organization}
          autoComplete="off"
          onChange={(e) => set('organization', e.target.value)}
          {...describedBy('organization', errors)}
        />
        <p id="member-organization-help" className="text-xs text-muted-foreground">
          Facultatif. Par exemple « CCI Touraine » ou « Angels Touraine ».
        </p>
        <FieldError id="organization" error={errors.organization} />
      </div>

      {values.role === 'investisseur' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="member-investorType">Type d’investisseur</Label>
          <NativeSelect
            id="member-investorType"
            value={values.investorType}
            onChange={(e) => set('investorType', e.target.value)}
            className="h-9"
            {...describedBy('investorType', errors)}
          >
            <option value="">Non renseigné</option>
            {INVESTOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {INVESTOR_TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
          <p id="member-investorType-help" className="sr-only">
            Facultatif.
          </p>
          <FieldError id="investorType" error={errors.investorType} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              id="member-canManageWorkspace"
              type="checkbox"
              checked={values.canManageWorkspace}
              onChange={(e) => set('canManageWorkspace', e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
              {...describedBy('canManageWorkspace', errors)}
            />
            <span>
              Peut gérer le workspace
              <span
                id="member-canManageWorkspace-help"
                className="block text-xs text-muted-foreground"
              >
                Réglages, logo et membres, sauf le domaine email (administrateurs de Confluent).
              </span>
            </span>
          </label>
          {givesUpOwnRight && (
            <p className="text-xs text-foreground">
              Vous ne pourrez plus gérer ce workspace après l’enregistrement.
            </p>
          )}
          <FieldError id="canManageWorkspace" error={errors.canManageWorkspace} />
        </div>
      )}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Inviter'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

function FieldError({ id, error }: { id: FieldName; error?: string }) {
  return (
    <div aria-live="assertive">
      {error && (
        <p id={`member-${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function describedBy(field: FieldName, errors: Errors) {
  const error = errors[field]
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error
      ? `member-${field}-error member-${field}-help`
      : `member-${field}-help`,
  }
}

function collect(issues: Array<{ path: PropertyKey[]; message: string }>, found: Errors) {
  for (const issue of issues) {
    const field = issue.path[0]
    if (isField(field)) found[field] ??= issue.message
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`member-${first}`)?.focus()
}

// Only what differs from the member as loaded: an edit never rewrites what it did not touch.
function changedFields(member: WorkspaceMember, next: MemberFields): UpdateWorkspaceMemberInput {
  const changes: UpdateWorkspaceMemberInput = {}
  if (next.role !== member.role) changes.role = next.role
  if (next.organization.trim() !== (member.organization ?? '')) {
    changes.organization = next.organization
  }
  if (next.investorType !== undefined && next.investorType !== member.investorType) {
    changes.investorType = next.investorType
  }
  if (
    next.canManageWorkspace !== undefined &&
    next.canManageWorkspace !== member.canManageWorkspace
  ) {
    changes.canManageWorkspace = next.canManageWorkspace
  }
  return changes
}

// Field errors of an API refusal: validation details (address outside the domain included), or an
// address already member (409 on an invitation). Anything else is shown as a general error.
function fieldErrorsOf(err: ApiError | undefined, editing: boolean): Errors {
  if (!err) return {}
  const found: Errors = {}
  if (err.status === 400 && Array.isArray(err.details)) {
    for (const detail of err.details as Array<{ path?: unknown[]; message?: string }>) {
      const field = detail.path?.[0]
      if (isField(field) && detail.message) found[field] ??= detail.message
    }
  }
  if (!editing && err.status === 409 && Object.keys(found).length === 0) {
    found.email = err.message
  }
  return found
}
