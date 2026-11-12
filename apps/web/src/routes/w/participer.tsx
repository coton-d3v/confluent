import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { LoaderCircleIcon } from 'lucide-react'
import {
  PARTICIPATION_FORM_TIMING,
  PARTICIPATION_HONEYPOT_FIELD,
  PARTICIPATION_REQUEST_LIMITS,
  createParticipationRequestSchema,
  type ParticipationForm,
} from '@confluent/shared'
import { ConfluentWordmark } from '@/components/confluent/ConfluentWordmark'
import { LegalLinks } from '@/components/confluent/LegalLinks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CommitteeWhen } from '@/features/committees/components/CommitteeSummary'
import { getParticipationForm, sendParticipationRequest } from '@/features/participation/api'
import type { ApiError } from '@/lib/api-client'

type FieldName = 'name' | 'organization' | 'email' | 'message' | 'committeeIds'
type Errors = Partial<Record<FieldName, string>>
const FIELDS: FieldName[] = ['committeeIds', 'name', 'organization', 'email', 'message']
const isField = (key: unknown): key is FieldName => FIELDS.includes(key as FieldName)

type Loaded = { form: ParticipationForm; receivedAt: number }

// ROADMAP E08.04: a workspace's public participation form — anyone (an investor, a guest), signed
// in or not, asks to take part in one or more of the sessions its managers opened to requests. Only
// their name and time are shown. Sent, the request waits for the structure's decision: no account,
// no access, no email until then, which the page says before anything is typed. Not indexed by
// search engines.
export default function ParticipationRoute() {
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  return <ParticipationPage key={slug} slug={slug} preselected={searchParams.get('session')} />
}

function ParticipationPage({ slug, preselected }: { slug: string; preselected: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [values, setValues] = useState({ name: '', organization: '', email: '', message: '' })
  const [trap, setTrap] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const sentRef = useRef<HTMLDivElement>(null)

  // (Re)loads the sessions offered and a fresh form token; keeps what was typed and the sessions
  // still offered.
  async function load(initial = false): Promise<Loaded | null> {
    try {
      const form = await getParticipationForm(slug)
      const next = { form, receivedAt: Date.now() }
      setLoaded(next)
      setLoadError(null)
      const offered = new Set(form.committees.map((c) => c.id))
      setChosen((current) => {
        const kept = current.filter((id) => offered.has(id))
        if (!initial) return kept
        if (preselected && offered.has(preselected)) return [preselected]
        return form.committees.length === 1 ? [form.committees[0].id] : kept
      })
      return next
    } catch (err) {
      setLoadError(err as ApiError)
      return null
    }
  }

  useEffect(() => {
    void load(true)
    // Loaded once per page (keyed by slug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state === 'sent') sentRef.current?.focus()
  }, [state])

  function set(field: Exclude<FieldName, 'committeeIds'>, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFailure(null)
  }

  function toggle(id: string, on: boolean) {
    setChosen((current) => (on ? [...current, id] : current.filter((c) => c !== id)))
    setErrors((current) => ({ ...current, committeeIds: undefined }))
    setFailure(null)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!loaded) return
    setFailure(null)
    const input = {
      ...values,
      committeeIds: chosen,
      formToken: loaded.form.formToken,
      ...(trap ? { [PARTICIPATION_HONEYPOT_FIELD]: trap } : {}),
    }
    const parsed = createParticipationRequestSchema.safeParse(input)
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
    setState('sending')
    try {
      // The API refuses a form sent sooner than this after the page gave it (anti-robot).
      const wait = loaded.receivedAt + PARTICIPATION_FORM_TIMING.minFillMs + 200 - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      await sendParticipationRequest(slug, input)
      setState('sent')
    } catch (err) {
      setState('idle')
      handleRefusal(err as ApiError)
    }
  }

  function handleRefusal(err: ApiError | undefined) {
    const details = err?.details
    if (err?.status === 400 && Array.isArray(details)) {
      const found: Errors = {}
      for (const d of details as Array<{ path?: unknown[]; message?: string }>) {
        const field = d.path?.[0]
        if (isField(field) && d.message) found[field] ??= d.message
      }
      if (Object.keys(found).length > 0) {
        setErrors(found)
        focusFirstError(found)
        return
      }
    }
    if (err?.status === 400 || err?.status === 409) {
      // An expired form, or a session no longer offered: the sessions and the token are read again,
      // what was typed is kept.
      void load()
      setFailure(
        err.status === 409
          ? 'Une session choisie n’est plus ouverte aux demandes : la liste a été mise à jour, vérifiez votre choix puis envoyez de nouveau.'
          : 'Le formulaire a été rechargé : envoyez-le de nouveau.',
      )
      return
    }
    if (err?.status === 404) {
      setLoadError(err)
      return
    }
    setFailure(
      err?.status === 429 || err?.status === 503
        ? err.message
        : 'Envoi impossible pour le moment. Réessayez dans quelques instants.',
    )
  }

  if (loadError) {
    return (
      <PublicShell title="Demande de participation">
        <h1 className="font-heading text-2xl font-medium text-foreground">
          Demande de participation
        </h1>
        <p
          role="alert"
          className="rounded-lg border border-border bg-card p-4 text-sm text-foreground"
        >
          {loadError.status === 404
            ? 'Aucune session n’est ouverte aux demandes de participation à cette adresse. Vérifiez le lien reçu, ou contactez la structure qui vous l’a donné.'
            : 'Le formulaire est indisponible pour le moment. Réessayez dans quelques instants.'}
        </p>
        {loadError.status !== 404 && (
          <Button type="button" variant="outline" onClick={() => void load(true)}>
            Réessayer
          </Button>
        )}
      </PublicShell>
    )
  }
  if (!loaded) {
    return (
      <PublicShell title="Demande de participation">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </PublicShell>
    )
  }

  const { workspace, committees } = loaded.form
  const structure = workspace.programName ?? workspace.name

  if (state === 'sent') {
    return (
      <PublicShell title={`Demande envoyée · ${structure}`}>
        <div
          ref={sentRef}
          tabIndex={-1}
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 focus-visible:outline-none"
        >
          <h1 className="font-heading text-xl font-medium text-foreground">Demande envoyée</h1>
          <p className="text-sm text-foreground">
            {workspace.name} a reçu votre demande. Elle sera étudiée par l’équipe de la structure :
            si elle est acceptée, vous recevrez une invitation par email à l’adresse indiquée.
          </p>
          <p className="text-sm text-muted-foreground">
            Aucun compte n’a été créé et aucun email ne vous est envoyé pour l’instant. Si vous avez
            déjà fait une demande auprès de cette structure, les sessions choisies y sont ajoutées.
          </p>
        </div>
      </PublicShell>
    )
  }

  const messageLength = values.message.length
  return (
    <PublicShell title={`Demande de participation · ${structure}`}>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground wrap-anywhere">{structure}</p>
        <h1 className="font-heading text-2xl font-medium text-foreground">
          Demander à participer à un comité
        </h1>
        <p className="text-sm text-muted-foreground">
          Investisseur, partenaire ou invité : choisissez une ou plusieurs sessions et
          présentez-vous. La structure étudiera votre demande.
        </p>
      </header>

      <section
        aria-labelledby="participation-privacy-title"
        className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm"
      >
        <h2 id="participation-privacy-title" className="font-medium text-foreground">
          Ce que deviennent vos informations
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          <li>
            Votre nom, votre organisation, votre adresse email, votre message et les sessions
            choisies sont transmis à {workspace.name}, qui seul les lit, pour étudier votre demande.
          </li>
          <li>
            Envoyer ce formulaire ne crée aucun compte et ne donne accès à rien. Aucun email ne vous
            est envoyé à ce stade.
          </li>
          <li>
            Si la structure accepte votre demande, elle vous invitera par email ; sinon, elle ne
            vous donnera aucun accès.
          </li>
        </ul>
        <p className="text-muted-foreground">
          En savoir plus :{' '}
          <Link to="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </section>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={errors.committeeIds ? 'participation-committeeIds-error' : undefined}
        >
          <legend className="mb-1 text-sm font-medium text-foreground">
            Sessions <span aria-hidden="true">*</span>
          </legend>
          <ul className="flex flex-col gap-2">
            {committees.map((committee, i) => (
              <li key={committee.id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-[:checked]:border-foreground">
                  <input
                    id={i === 0 ? 'participation-committeeIds' : undefined}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={chosen.includes(committee.id)}
                    onChange={(e) => toggle(committee.id, e.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="wrap-anywhere text-sm font-medium text-foreground">
                      {committee.name}
                    </span>
                    <CommitteeWhen committee={committee} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <FieldError field="committeeIds" error={errors.committeeIds} />
        </fieldset>

        <Field id="name" label="Nom et prénom" required error={errors.name}>
          <Input
            id="participation-name"
            autoComplete="name"
            value={values.name}
            maxLength={PARTICIPATION_REQUEST_LIMITS.name}
            onChange={(e) => set('name', e.target.value)}
            {...invalid('name', errors)}
          />
        </Field>
        <Field
          id="organization"
          label="Organisation"
          error={errors.organization}
          help="Fonds, réseau, entreprise… Laissez vide si vous venez à titre personnel."
        >
          <Input
            id="participation-organization"
            autoComplete="organization"
            value={values.organization}
            maxLength={PARTICIPATION_REQUEST_LIMITS.organization}
            onChange={(e) => set('organization', e.target.value)}
            {...invalid('organization', errors)}
          />
        </Field>
        <Field
          id="email"
          label="Adresse email"
          required
          error={errors.email}
          help="Celle à laquelle la structure vous répondra."
        >
          <Input
            id="participation-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            maxLength={PARTICIPATION_REQUEST_LIMITS.email}
            onChange={(e) => set('email', e.target.value)}
            {...invalid('email', errors)}
          />
        </Field>
        <Field
          id="message"
          label="Message"
          error={errors.message}
          help={`Facultatif : présentez-vous et dites ce qui vous intéresse. Texte simple, ${messageLength} / ${PARTICIPATION_REQUEST_LIMITS.message} caractères.`}
        >
          <Textarea
            id="participation-message"
            rows={5}
            value={values.message}
            maxLength={PARTICIPATION_REQUEST_LIMITS.message}
            onChange={(e) => set('message', e.target.value)}
            {...invalid('message', errors)}
          />
        </Field>

        {/* Left empty by people: hidden from them and from assistive technologies, out of the tab
            order. Robots filling every field are set aside. */}
        <div
          aria-hidden="true"
          className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="participation-website">Site web (ne pas remplir)</label>
          <input
            id="participation-website"
            name={PARTICIPATION_HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </div>

        <div aria-live="assertive">
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full sm:w-auto"
          disabled={state === 'sending'}
        >
          {state === 'sending' ? (
            <>
              <LoaderCircleIcon
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Envoi…
            </>
          ) : (
            'Envoyer ma demande'
          )}
        </Button>
      </form>
    </PublicShell>
  )
}

// A signed-out page, readable at 375 px, not indexed.
function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <title>{`${title} · Confluent`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <main className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10 sm:px-6">
        <ConfluentWordmark className="h-7 w-auto text-foreground" />
        <div className="flex w-full max-w-xl flex-col gap-6">{children}</div>
        <LegalLinks className="justify-center" />
      </main>
    </>
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
  id: Exclude<FieldName, 'committeeIds'>
  label: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`participation-${id}`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children}
      {help && (
        <p id={`participation-${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <FieldError field={id} error={error} />
    </div>
  )
}

function FieldError({ field, error }: { field: FieldName; error?: string }) {
  return (
    <div aria-live="assertive">
      {error && (
        <p id={`participation-${field}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function invalid(field: FieldName, errors: Errors) {
  const error = errors[field]
  return {
    'aria-invalid': error ? true : undefined,
    'aria-required': field === 'name' || field === 'email' ? true : undefined,
    'aria-describedby':
      [
        error ? `participation-${field}-error` : null,
        field === 'name' ? null : `participation-${field}-help`,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  }
}

function focusFirstError(errors: Errors) {
  const first = FIELDS.find((field) => errors[field])
  if (first) document.getElementById(`participation-${first}`)?.focus()
}
